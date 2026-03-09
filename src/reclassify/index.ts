import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { classifyEmail } from '../shared/classifier';
import { query, upsert, CONTAINERS } from '../shared/cosmos';
import { generateEmbedding, buildEmailEmbedText } from '../shared/embed';
import { fetchEmailById } from '../shared/graph';
import { validateRequest } from '../shared/rbac';

// ── POST /api/reclassify ──────────────────────────────────
// Re-classifies existing emails with the latest classifier
// (lane detection, new scoring signals) while preserving all
// action states (done/archived/delegated/snoozed/delegatedTo).
//
// Body options:
//   { "container": "emails" }           — re-classify live inbox (default)
//   { "container": "email-archive" }    — re-classify backfill archive
//   { "force": true }                   — re-classify even if lane=active (re-scores everything)
//   { "limit": 200 }                    — cap at N emails (default 500)

app.http('reclassify', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'reclassify',
  handler: async (req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {

    // ── AUTH — CEO-only operation ──────────────────────────
    const caller = await validateRequest(req);
    if (!caller) return { status: 401, body: 'Unauthorized' };
    if (caller.user.level < 9) return { status: 403, body: 'CEO-level access required' };

    let body: { container?: string; force?: boolean; limit?: number } = {};
    try { body = await req.json() as typeof body; } catch { /* defaults */ }

    const containerName = body.container === 'email-archive'
      ? CONTAINERS.EMAIL_ARCHIVE
      : CONTAINERS.EMAILS;

    const limit = Math.min(body.limit ?? 500, 2000);
    const force = body.force ?? false;

    context.log(`[reclassify] Starting — container=${containerName}, limit=${limit}, force=${force}`);

    // ── LOAD EMAILS FOR RECLASSIFICATION ──────────────────
    // Skip emails already in an automated/low-signal lane unless force=true
    const filterClause = force
      ? ''
      : `AND (NOT IS_DEFINED(c.lane) OR c.lane = 'active')`;

    const emails = await query<{
      id: string;
      subject: string;
      from: { name: string; email: string };
      receivedDateTime: string;
      isRead: boolean;
      hasAttachments: boolean;
      bodyPreview: string;
      conversationId: string;
      // Preserved action state
      status: string;
      snoozedUntil?: string;
      delegatedTo?: string;
      delegatedAt?: string;
      archivedAt?: string;
      doneAt?: string;
      // Old classification (to be replaced)
      bu?: string;
      tier?: number;
      aiScore?: number;
    }>(
      containerName,
      `SELECT TOP ${limit} c.id, c.subject, c[\"from\"], c.receivedDateTime,
              c.isRead, c.hasAttachments, c.bodyPreview, c.conversationId,
              c.status, c.snoozedUntil, c.delegatedTo, c.delegatedAt,
              c.archivedAt, c.doneAt, c.bu, c.tier, c.aiScore
       FROM c WHERE IS_DEFINED(c.id) ${filterClause}
       ORDER BY c.receivedDateTime DESC`
    );

    context.log(`[reclassify] Loaded ${emails.length} emails to reclassify`);

    let updated = 0;
    let errors  = 0;
    let skipped = 0;

    const ceoEmail = process.env.CEO_EMAIL || 'ceo@iol.world';

    for (const stored of emails) {
      try {
        // Build a minimal GraphEmail shape so classifyEmail can work with it.
        // We fetch from Graph only if bodyPreview is sparse — most stored emails have enough.
        let graphEmail: import('../shared/graph').GraphEmail;
        try {
          graphEmail = await fetchEmailById(ceoEmail, stored.id);
        } catch {
          // Graph fetch failed (email may have been deleted). Build from stored data.
          graphEmail = {
            id:               stored.id,
            subject:          stored.subject ?? '',
            from:             { emailAddress: { name: stored.from?.name ?? '', address: stored.from?.email ?? '' } },
            toRecipients:     [],
            ccRecipients:     [],
            receivedDateTime: stored.receivedDateTime,
            isRead:           stored.isRead ?? false,
            importance:       'normal',
            hasAttachments:   stored.hasAttachments ?? false,
            bodyPreview:      stored.bodyPreview ?? '',
            body:             { contentType: 'text', content: stored.bodyPreview ?? '' },
            conversationId:   stored.conversationId ?? '',
          };
        }

        const result = await classifyEmail(graphEmail);

        // Build embed text for vector search
        const embedText = buildEmailEmbedText({
          subject:     stored.subject,
          from:        stored.from,
          bu:          result.bu,
          tags:        result.tags,
          summary:     result.summary,
          bodyPreview: stored.bodyPreview,
        });
        const embedding = await generateEmbedding(embedText);

        // Read the full existing document so we don't lose any fields
        const { query: _q, ...cosmosMod } = await import('../shared/cosmos');
        const { getById } = cosmosMod;
        const existing = await getById<Record<string, unknown>>(containerName, stored.id);
        if (!existing) { skipped++; continue; }

        // Merge: preserve all action state, replace classification fields
        const updated_doc = {
          ...existing,
          bu:                 result.bu,
          tier:               result.tier,
          aiScore:            result.aiScore,
          tags:               result.tags,
          lane:               result.lane,
          isVip:              result.isVip,
          isPinned:           result.isPinned,
          isInternal:         result.isInternal,
          summary:            result.summary,
          actionRequired:     result.actionRequired,
          suggestedDelegatee: result.suggestedDelegatee,
          sentiment:          result.sentiment,
          reclassifiedAt:     new Date().toISOString(),
          ...(embedding.length > 0 ? { embedding } : {}),
        };

        await upsert(containerName, updated_doc as unknown as { id: string });
        updated++;

        // Rate limit: 200ms between emails
        await sleep(200);

      } catch (err) {
        context.error(`[reclassify] Failed email ${stored.id}:`, err);
        errors++;
      }
    }

    const summary = {
      total: emails.length,
      updated,
      skipped,
      errors,
      container: containerName,
      force,
    };

    context.log('[reclassify] Done:', summary);

    return {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(summary),
    };
  },
});

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
