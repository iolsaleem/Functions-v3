import { app, InvocationContext, Timer } from '@azure/functions';
import { fetchRecentEmails } from '../shared/graph';
import { classifyEmail } from '../shared/classifier';
import { upsert, query, CONTAINERS } from '../shared/cosmos';
import { generateEmbedding, buildEmailEmbedText } from '../shared/embed';
import { PINNED_SENDERS } from '../shared/constants';

interface AthenaEmail {
  id: string;
  graphId: string;
  subject: string;
  from: { name: string; email: string };
  receivedDateTime: string;
  isRead: boolean;
  bu: string;
  tier: number;
  aiScore: number;
  tags: string[];
  isVip: boolean;
  isPinned: boolean;
  isInternal: boolean;
  summary: string;
  actionRequired: string;
  suggestedDelegatee: string | null;
  sentiment: string;
  status: string;
  snoozedUntil?: string;
  delegatedTo?: string;
  delegatedAt?: string;
  archivedAt?: string;
  doneAt?: string;
  hasAttachments: boolean;
  bodyPreview: string;
  bodyContent: string;
  bodyContentType: string;
  lastSynced: string;
  embedding?: number[];
}

const PAGE_SIZE = 50;
const MAX_PAGES = 10;

app.timer('emailSync', {
  schedule: `0 */${process.env.EMAIL_POLL_INTERVAL_MINUTES || '5'} * * * *`,
  handler: async (_timer: Timer, context: InvocationContext) => {
    context.log('[emailSync] Starting email sync...');

    const ceoEmail = process.env.CEO_EMAIL || 'ceo@iol.world';

    const corrections = await query<{ senderEmail: string; correctedBU: string }>(
      CONTAINERS.CLASSIFIER,
      'SELECT c.senderEmail, c.correctedBU FROM c WHERE c.type = "pinned"'
    );
    const dynamicPins: Record<string, string> = {};
    corrections.forEach(c => { dynamicPins[c.senderEmail] = c.correctedBU; });
    const allPins = { ...PINNED_SENDERS, ...dynamicPins } as Record<string, string>;

    const lastSyncRec = await query<{ lastSynced: string }>(
      CONTAINERS.EMAILS,
      'SELECT TOP 10 c.lastSynced FROM c WHERE IS_DEFINED(c.lastSynced)'
    ).then(results => results.sort((a, b) => (b.lastSynced ?? '').localeCompare(a.lastSynced ?? '')));

    const sinceDate = lastSyncRec[0]?.lastSynced
      ? new Date(new Date(lastSyncRec[0].lastSynced).getTime() - 2 * 60 * 1000).toISOString()
      : new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    let skip = 0;
    let totalFetched = 0;
    let classified = 0;
    let errors = 0;
    let hasMore = true;

    while (hasMore && skip < PAGE_SIZE * MAX_PAGES) {
      const emails = await fetchRecentEmails(ceoEmail, PAGE_SIZE, skip, sinceDate);
      context.log(`[emailSync] Page skip=${skip}: fetched ${emails.length} emails`);

      if (emails.length === 0) { hasMore = false; break; }

      for (const email of emails) {
        try {
          const result = await classifyEmail(email, allPins as Record<string, import('../shared/constants').BU>);

          const doc: AthenaEmail = {
            id:                 email.id,
            graphId:            email.id,
            subject:            email.subject ?? '(no subject)',
            from:               { name: email.from?.emailAddress?.name ?? '', email: email.from?.emailAddress?.address ?? '' },
            receivedDateTime:   email.receivedDateTime,
            isRead:             email.isRead,
            bu:                 result.bu,
            tier:               result.tier,
            aiScore:            result.aiScore,
            tags:               result.tags,
            isVip:              result.isVip,
            isPinned:           result.isPinned,
            isInternal:         result.isInternal,
            summary:            result.summary,
            actionRequired:     result.actionRequired,
            suggestedDelegatee: result.suggestedDelegatee,
            sentiment:          result.sentiment,
            status:             'active',
            hasAttachments:     email.hasAttachments,
            bodyPreview:        email.bodyPreview ?? '',
            bodyContent:        (email.body?.content ?? '').slice(0, 500_000),
            bodyContentType:    email.body?.contentType ?? 'text',
            lastSynced:         new Date().toISOString(),
          };

          // Generate embedding for vector search
          const embedText = buildEmailEmbedText({
            subject: doc.subject,
            from: doc.from,
            bu: doc.bu,
            tags: doc.tags,
            summary: doc.summary,
            bodyPreview: doc.bodyPreview,
          });
          const embedding = await generateEmbedding(embedText);
          if (embedding.length > 0) doc.embedding = embedding;

          await upsert(CONTAINERS.EMAILS, doc);
          classified++;
        } catch (err) {
          context.error(`[emailSync] Failed to process email ${email.id}:`, err);
          errors++;
        }
      }

      totalFetched += emails.length;
      skip += PAGE_SIZE;
      if (emails.length < PAGE_SIZE) hasMore = false;
    }

    context.log(`[emailSync] Done. Total: ${totalFetched}, Classified: ${classified}, Errors: ${errors}`);
  },
});
