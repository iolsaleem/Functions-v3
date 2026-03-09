import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { query, upsert, getById, CONTAINERS } from '../shared/cosmos';
import { validateRequest } from '../shared/rbac';

app.http('getEmails', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'emails',
  handler: async (req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    const caller = await validateRequest(req);
    if (!caller) return { status: 401, body: 'Unauthorized' };

    const tab     = req.query.get('tab') ?? 'all';
    const bu      = req.query.get('bu');

    // ── ENV-CONTROLLED LIMIT ─────────────────────────────────────────────
    const defaultTop = parseInt(process.env.EMAILS_TOP || '500');
    const top     = Math.min(parseInt(req.query.get('top') ?? String(defaultTop)), 1000);

    const since   = req.query.get('since');
    const isCeo   = caller.user.level >= 10;
    const now     = new Date().toISOString();

    // ── BUILD SHARED WHERE CONDITIONS ──────────────────────────────────────
    const params: Array<{ name: string; value: unknown }> = [];

    let tabClause = '';
    switch (tab) {
      case 'unread':    tabClause = ` AND c.isRead = false AND c.status = 'active'`; break;
      case 'urgent':    tabClause = ` AND (ARRAY_CONTAINS(c.tags, 'urgent') OR c.sentiment = 'urgent') AND c.status = 'active'`; break;
      case 'delegated': tabClause = ` AND c.status = 'delegated'`; break;
      case 'archived':  tabClause = ` AND c.status = 'archived'`; break;
      case 'snoozed':
        tabClause = ` AND c.status = 'snoozed' AND c.snoozedUntil >= @now`;
        params.push({ name: '@now', value: now });
        break;
      default:
        tabClause = ` AND c.status = 'active'`;
    }

    let buScopeClause = '';
    if (!isCeo && caller.user.buScope.length > 0) {
      const buList = caller.user.buScope.map(b => `'${b.replace(/'/g, "\\'")}'`).join(',');
      buScopeClause = ` AND c.bu IN (${buList})`;
    }

    let buFilterClause = '';
    if (bu) {
      buFilterClause = ` AND c.bu = @buFilter`;
      params.push({ name: '@buFilter', value: bu });
    }

    const sinceDate = since ?? '2025-07-01T00:00:00.000Z';
    const sinceDateFull = sinceDate.includes('T') ? sinceDate : `${sinceDate}T00:00:00.000Z`;
    params.push({ name: '@since', value: sinceDateFull });
    const sinceClause = ` AND c.receivedDateTime >= @since`;

    const selectCols = `c.id, c.subject, c["from"], c.receivedDateTime, c.isRead,
      c.bu, c.tier, c.aiScore, c.tags, c.isVip, c.isPinned, c.isInternal,
      c.summary, c.actionRequired, c.suggestedDelegatee, c.sentiment,
      c.status, c.snoozedUntil, c.delegatedTo, c.hasAttachments,
      c.bodyPreview, c.bodyContent, c.bodyContentType, c.lane, c.repliedAt`;

    const baseWhere = `WHERE 1=1${tabClause}${buScopeClause}${buFilterClause}${sinceClause}`;
    const liveSQL = `SELECT TOP ${top} ${selectCols} FROM c ${baseWhere} ORDER BY c.receivedDateTime DESC`;
    const archiveSQL = `SELECT TOP ${top} ${selectCols} FROM c WHERE IS_DEFINED(c.id)${buScopeClause}${buFilterClause}${sinceClause} ORDER BY c.receivedDateTime DESC`;

    context.log(`[getEmails] tab=${tab}, since=${sinceDateFull}, top=${top}, fetching live + archive`);

    const [liveResult, archiveResult] = await Promise.allSettled([
      query<{ receivedDateTime: string; id: string } & Record<string, unknown>>(
        CONTAINERS.EMAILS, liveSQL, params
      ),
      query<{ receivedDateTime: string; id: string } & Record<string, unknown>>(
        CONTAINERS.EMAIL_ARCHIVE, archiveSQL, params
      ),
    ]);

    if (liveResult.status    === 'rejected') context.warn('[getEmails] Live query failed:', liveResult.reason);
    if (archiveResult.status === 'rejected') context.warn('[getEmails] Archive query failed:', archiveResult.reason);

    const live    = liveResult.status    === 'fulfilled' ? liveResult.value    : [];
    const archive = archiveResult.status === 'fulfilled' ? archiveResult.value : [];

    const seenIds = new Set<string>();
    const merged: Array<Record<string, unknown>> = [];
    for (const e of live)    { seenIds.add(e.id); merged.push(e); }
    for (const e of archive) { if (!seenIds.has(e.id)) { seenIds.add(e.id); merged.push(e); } }

    merged.sort((a, b) =>
      ((b.receivedDateTime as string) ?? '').localeCompare((a.receivedDateTime as string) ?? '')
    );
    const emails = merged.slice(0, top);

    context.log(`[getEmails] Returning ${emails.length} emails (live: ${live.length}, archive: ${archive.length})`);

    // ── RE-SURFACE SNOOZED EMAILS ─────────────────────────────────────────
    const resurface = await query(
      CONTAINERS.EMAILS,
      `SELECT c.id FROM c WHERE c.status = 'snoozed' AND c.snoozedUntil <= @now`,
      [{ name: '@now', value: now }]
    ) as { id: string }[];

    if (resurface.length > 0) {
      await Promise.all(resurface.map(async (e) => {
        const existing = await getById<{ id: string } & Record<string, unknown>>(CONTAINERS.EMAILS, e.id);
        if (existing) await upsert(CONTAINERS.EMAILS, { ...existing, status: 'active', snoozedUntil: null });
      }));
    }

    let backfillComplete = false;
    try {
      const bfState = await getById<{ pass1Complete?: boolean; pass2Complete?: boolean; pass3Complete?: boolean }>(
        CONTAINERS.BACKFILL_STATE, 'backfill-main'
      );
      backfillComplete = !!(bfState?.pass1Complete && bfState?.pass2Complete && bfState?.pass3Complete);
    } catch { /* not yet run */ }

    return {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        emails,
        count: emails.length,
        sources: { live: live.length, archive: archive.length },
        since: sinceDateFull,
        backfillComplete,
      }),
    };
  },
});