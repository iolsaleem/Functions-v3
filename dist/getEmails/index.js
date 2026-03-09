"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const functions_1 = require("@azure/functions");
const cosmos_1 = require("../shared/cosmos");
const rbac_1 = require("../shared/rbac");
functions_1.app.http('getEmails', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'emails',
    handler: async (req, context) => {
        const caller = await (0, rbac_1.validateRequest)(req);
        if (!caller)
            return { status: 401, body: 'Unauthorized' };
        const tab = req.query.get('tab') ?? 'all';
        const bu = req.query.get('bu');
        // ── ENV-CONTROLLED LIMIT ─────────────────────────────────────────────
        const defaultTop = parseInt(process.env.EMAILS_TOP || '500');
        const top = Math.min(parseInt(req.query.get('top') ?? String(defaultTop)), 1000);
        const since = req.query.get('since');
        const isCeo = caller.user.level >= 10;
        const now = new Date().toISOString();
        // ── BUILD SHARED WHERE CONDITIONS ──────────────────────────────────────
        const params = [];
        let tabClause = '';
        switch (tab) {
            case 'unread':
                tabClause = ` AND c.isRead = false AND c.status = 'active'`;
                break;
            case 'urgent':
                tabClause = ` AND (ARRAY_CONTAINS(c.tags, 'urgent') OR c.sentiment = 'urgent') AND c.status = 'active'`;
                break;
            case 'delegated':
                tabClause = ` AND c.status = 'delegated'`;
                break;
            case 'archived':
                tabClause = ` AND c.status = 'archived'`;
                break;
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
            (0, cosmos_1.query)(cosmos_1.CONTAINERS.EMAILS, liveSQL, params),
            (0, cosmos_1.query)(cosmos_1.CONTAINERS.EMAIL_ARCHIVE, archiveSQL, params),
        ]);
        if (liveResult.status === 'rejected')
            context.warn('[getEmails] Live query failed:', liveResult.reason);
        if (archiveResult.status === 'rejected')
            context.warn('[getEmails] Archive query failed:', archiveResult.reason);
        const live = liveResult.status === 'fulfilled' ? liveResult.value : [];
        const archive = archiveResult.status === 'fulfilled' ? archiveResult.value : [];
        const seenIds = new Set();
        const merged = [];
        for (const e of live) {
            seenIds.add(e.id);
            merged.push(e);
        }
        for (const e of archive) {
            if (!seenIds.has(e.id)) {
                seenIds.add(e.id);
                merged.push(e);
            }
        }
        merged.sort((a, b) => (b.receivedDateTime ?? '').localeCompare(a.receivedDateTime ?? ''));
        const emails = merged.slice(0, top);
        context.log(`[getEmails] Returning ${emails.length} emails (live: ${live.length}, archive: ${archive.length})`);
        // ── RE-SURFACE SNOOZED EMAILS ─────────────────────────────────────────
        const resurface = await (0, cosmos_1.query)(cosmos_1.CONTAINERS.EMAILS, `SELECT c.id FROM c WHERE c.status = 'snoozed' AND c.snoozedUntil <= @now`, [{ name: '@now', value: now }]);
        if (resurface.length > 0) {
            await Promise.all(resurface.map(async (e) => {
                const existing = await (0, cosmos_1.getById)(cosmos_1.CONTAINERS.EMAILS, e.id);
                if (existing)
                    await (0, cosmos_1.upsert)(cosmos_1.CONTAINERS.EMAILS, { ...existing, status: 'active', snoozedUntil: null });
            }));
        }
        let backfillComplete = false;
        try {
            const bfState = await (0, cosmos_1.getById)(cosmos_1.CONTAINERS.BACKFILL_STATE, 'backfill-main');
            backfillComplete = !!(bfState?.pass1Complete && bfState?.pass2Complete && bfState?.pass3Complete);
        }
        catch { /* not yet run */ }
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
//# sourceMappingURL=index.js.map