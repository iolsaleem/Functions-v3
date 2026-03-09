import { app, Timer, InvocationContext } from '@azure/functions';
import { fetchEmailPageForBackfill, fetchSentPageForBackfill } from '../shared/graph';
import { classifyEmail } from '../shared/classifier';
import { upsert, getById, query, CONTAINERS } from '../shared/cosmos';
import { generateEmbedding, buildEmailEmbedText } from '../shared/embed';

const BATCH_SIZE       = 20;
const CHECKPOINT_EVERY = 10;   // Checkpoint every 10 emails — minimises re-work on timeout

// ── TIME BUDGET ──────────────────────────────────────────────────────────────
// Stop processing with 90s to spare so state is saved cleanly before the
// function host kills us. Each nightly run resumes via pass1NextLink/pass2NextLink.
const MAX_RUN_MS = 8 * 60 * 1000; // 8 minutes (host timeout = 10 min)

interface BackfillState {
  id: string;
  // Pass 1 — inbox
  pass1Complete: boolean;
  pass1NextLink?: string;
  pass1Count: number;
  // Pass 2 — sent items
  pass2Complete: boolean;
  pass2NextLink?: string;
  pass2Count: number;
  // Pass 3 — reply match
  pass3Complete: boolean;
  pass3Count: number;
  lastUpdated: string;
}

app.timer('backfill', {
  // Runs every 15 minutes so multi-pass backfill self-drives to completion.
  // Each invocation processes 8 minutes of work then saves state and exits.
  // Once all 3 passes are complete the function exits in <1s — no wasted cost.
  schedule: '0 */15 * * * *',
  runOnStartup: true,   // start immediately on deploy
  handler: async (_timer: Timer, context: InvocationContext) => {
    const state = await getById<BackfillState>(CONTAINERS.BACKFILL_STATE, 'backfill-main') ?? {
      id: 'backfill-main',
      pass1Complete: false, pass1NextLink: undefined, pass1Count: 0,
      pass2Complete: false, pass2NextLink: undefined, pass2Count: 0,
      pass3Complete: false, pass3Count: 0,
      lastUpdated: new Date().toISOString(),
    };

    if (state.pass1Complete && state.pass2Complete && state.pass3Complete) {
      context.log('[backfill] All three passes complete — nothing to do');
      return;
    }

    const ceoEmail      = process.env.CEO_EMAIL || 'ceo@iol.world';
    const backfillStart = `${process.env.BACKFILL_START_DATE || '2025-07-01'}T00:00:00Z`;
    const startTime     = Date.now();
    const isTimeUp      = () => (Date.now() - startTime) >= MAX_RUN_MS;

    // ══════════════════════════════════════════════════════
    // PASS 1 — Inbox: classify + embed → email-archive
    // ══════════════════════════════════════════════════════
    if (!state.pass1Complete) {
      context.log('[backfill] Pass 1: inbox classify + embed → email-archive');
      let nextLink: string | undefined = state.pass1NextLink;
      let count = state.pass1Count;
      let hasMore = true;

      while (hasMore) {
        const { emails, nextLink: nl } = await fetchEmailPageForBackfill(ceoEmail, nextLink, backfillStart);
        if (emails.length === 0) { hasMore = false; break; }

        for (const email of emails) {
          try {
            // Skip if already archived
            const existing = await getById(CONTAINERS.EMAIL_ARCHIVE, email.id);
            if (existing) { count++; continue; }

            // Inherit status from live emails container if present
            const live = await getById<{ status?: string }>(CONTAINERS.EMAILS, email.id);
            const inheritedStatus = live?.status ?? 'archive';
            const status = ['done', 'archived', 'delegated'].includes(inheritedStatus) ? inheritedStatus : 'archive';

            const result = await classifyEmail(email);

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const doc: any = {
              id:               email.id,
              graphId:          email.id,
              subject:          email.subject ?? '',
              from:             { name: email.from?.emailAddress?.name ?? '', email: email.from?.emailAddress?.address ?? '' },
              receivedDateTime: email.receivedDateTime,
              bu:               result.bu,
              tier:             result.tier,
              aiScore:          result.aiScore,
              tags:             result.tags,
              lane:             result.lane,
              summary:          result.summary,
              actionRequired:   result.actionRequired,
              sentiment:        result.sentiment,
              status,
              isInternal:       result.isInternal,
              isVip:            result.isVip,
              hasAttachments:   email.hasAttachments,
              bodyPreview:      email.bodyPreview ?? '',
              bodyContent:      (email.body?.content ?? '').slice(0, 500_000),
              bodyContentType:  email.body?.contentType ?? 'text',
              conversationId:   email.conversationId,
              backfilledAt:     new Date().toISOString(),
            };

            const embedText = buildEmailEmbedText({ subject: doc.subject, from: doc.from, bu: doc.bu, tags: doc.tags, summary: doc.summary, bodyPreview: doc.bodyPreview });
            const embedding = await generateEmbedding(embedText);
            if (embedding.length > 0) doc.embedding = embedding;

            await upsert(CONTAINERS.EMAIL_ARCHIVE, doc);
            count++;

            if (count % CHECKPOINT_EVERY === 0) {
              state.pass1NextLink = nl;
              state.pass1Count    = count;
              state.lastUpdated   = new Date().toISOString();
              await upsert(CONTAINERS.BACKFILL_STATE, state);
              context.log(`[backfill] Pass 1 checkpoint: ${count} emails`);
            }

            await sleep(50);
          } catch (err) {
            context.warn(`[backfill] Pass 1 failed email ${email.id}:`, err);
            count++;
          }
        }

        nextLink = nl;
        if (!nextLink || emails.length < BATCH_SIZE) { hasMore = false; }

        if (isTimeUp() && hasMore) {
          state.pass1NextLink = nextLink;
          state.pass1Count    = count;
          state.lastUpdated   = new Date().toISOString();
          await upsert(CONTAINERS.BACKFILL_STATE, state);
          context.log(`[backfill] Time budget reached. Pass 1 paused at ${count} emails. Resuming next run.`);
          return;
        }
      }

      state.pass1Complete = true;
      state.pass1Count    = count;
      state.pass1NextLink = undefined;
      state.lastUpdated   = new Date().toISOString();
      await upsert(CONTAINERS.BACKFILL_STATE, state);
      context.log(`[backfill] Pass 1 complete. Total: ${count}`);
    }

    // ══════════════════════════════════════════════════════
    // PASS 2 — Sent items → sent-items (no Claude)
    // ══════════════════════════════════════════════════════
    if (state.pass1Complete && !state.pass2Complete) {
      context.log('[backfill] Pass 2: sent items → sent-items container');
      let nextLink: string | undefined = state.pass2NextLink;
      let count = state.pass2Count;
      let hasMore = true;

      while (hasMore) {
        const { emails, nextLink: nl } = await fetchSentPageForBackfill(ceoEmail, nextLink, backfillStart);
        if (emails.length === 0) { hasMore = false; break; }

        for (const email of emails) {
          try {
            const existing = await getById(CONTAINERS.SENT_ITEMS, email.id);
            if (existing) { count++; continue; }

            await upsert(CONTAINERS.SENT_ITEMS, {
              id:               email.id,
              graphId:          email.id,
              subject:          email.subject ?? '',
              to:               (email.toRecipients ?? []).map(r => ({ name: r.emailAddress?.name ?? '', email: r.emailAddress?.address ?? '' })),
              sentDateTime:     email.receivedDateTime,
              hasAttachments:   email.hasAttachments,
              bodyPreview:      email.bodyPreview ?? '',
              conversationId:   email.conversationId,
              backfilledAt:     new Date().toISOString(),
            });

            count++;
            if (count % CHECKPOINT_EVERY === 0) {
              state.pass2NextLink = nl;
              state.pass2Count    = count;
              state.lastUpdated   = new Date().toISOString();
              await upsert(CONTAINERS.BACKFILL_STATE, state);
              context.log(`[backfill] Pass 2 checkpoint: ${count} sent items`);
            }
            await sleep(50);
          } catch (err) {
            context.warn(`[backfill] Pass 2 failed sent ${email.id}:`, err);
            count++;
          }
        }

        nextLink = nl;
        if (!nextLink || emails.length < BATCH_SIZE) { hasMore = false; }

        if (isTimeUp() && hasMore) {
          state.pass2NextLink = nextLink;
          state.pass2Count    = count;
          state.lastUpdated   = new Date().toISOString();
          await upsert(CONTAINERS.BACKFILL_STATE, state);
          context.log(`[backfill] Time budget reached. Pass 2 paused at ${count} sent items. Resuming next run.`);
          return;
        }
      }

      state.pass2Complete = true;
      state.pass2Count    = count;
      state.pass2NextLink = undefined;
      state.lastUpdated   = new Date().toISOString();
      await upsert(CONTAINERS.BACKFILL_STATE, state);
      context.log(`[backfill] Pass 2 complete. Sent items: ${count}`);
    }

    // ══════════════════════════════════════════════════════
    // PASS 3 — Reply match: link sent items → email-archive
    // ══════════════════════════════════════════════════════
    if (state.pass1Complete && state.pass2Complete && !state.pass3Complete) {
      context.log('[backfill] Pass 3: reply match');
      let count = 0;

      // Load all sent items and build a conversationId → sentDateTime map
      const sentItems = await query<{ id: string; conversationId: string; sentDateTime: string }>(
        CONTAINERS.SENT_ITEMS,
        'SELECT c.id, c.conversationId, c.sentDateTime FROM c WHERE IS_DEFINED(c.conversationId)'
      );

      const replyMap = new Map<string, string>(); // conversationId → earliest sentDateTime
      for (const s of sentItems) {
        if (!s.conversationId) continue;
        const existing = replyMap.get(s.conversationId);
        if (!existing || s.sentDateTime < existing) {
          replyMap.set(s.conversationId, s.sentDateTime);
        }
      }

      context.log(`[backfill] Pass 3: ${replyMap.size} conversations with sent replies`);

      // Update email-archive records that have a matching conversationId
      const archived = await query<{ id: string; conversationId: string; receivedDateTime: string }>(
        CONTAINERS.EMAIL_ARCHIVE,
        'SELECT c.id, c.conversationId, c.receivedDateTime FROM c WHERE IS_DEFINED(c.conversationId)'
      );

      for (const archived_email of archived) {
        if (!archived_email.conversationId) continue;
        const sentDateTime = replyMap.get(archived_email.conversationId);
        if (!sentDateTime) continue;

        // Only mark as replied if the sent item came AFTER the received email
        if (sentDateTime <= archived_email.receivedDateTime) continue;

        try {
          const full = await getById<Record<string, unknown>>(CONTAINERS.EMAIL_ARCHIVE, archived_email.id);
          if (!full) continue;

          const replyLatencyMs = new Date(sentDateTime).getTime() - new Date(archived_email.receivedDateTime).getTime();
          await upsert(CONTAINERS.EMAIL_ARCHIVE, {
            ...full,
            repliedAt:           sentDateTime,
            replyLatencyHours:   Math.round(replyLatencyMs / (1000 * 60 * 60) * 10) / 10,
          } as unknown as { id: string });
          count++;
          await sleep(50);
        } catch (err) {
          context.warn(`[backfill] Pass 3 update failed ${archived_email.id}:`, err);
        }
      }

      state.pass3Complete = true;
      state.pass3Count    = count;
      state.lastUpdated   = new Date().toISOString();
      await upsert(CONTAINERS.BACKFILL_STATE, state);
      context.log(`[backfill] Pass 3 complete. ${count} emails matched with replies`);
    }
  },
});

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
