"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const functions_1 = require("@azure/functions");
const graph_1 = require("../shared/graph");
const classifier_1 = require("../shared/classifier");
const cosmos_1 = require("../shared/cosmos");
const embed_1 = require("../shared/embed");
const constants_1 = require("../shared/constants");
const PAGE_SIZE = 50;
const MAX_PAGES = 10;
functions_1.app.timer('emailSync', {
    schedule: `0 */${process.env.EMAIL_POLL_INTERVAL_MINUTES || '5'} * * * *`,
    handler: async (_timer, context) => {
        context.log('[emailSync] Starting email sync...');
        const ceoEmail = process.env.CEO_EMAIL || 'ceo@iol.world';
        const corrections = await (0, cosmos_1.query)(cosmos_1.CONTAINERS.CLASSIFIER, 'SELECT c.senderEmail, c.correctedBU FROM c WHERE c.type = "pinned"');
        const dynamicPins = {};
        corrections.forEach(c => { dynamicPins[c.senderEmail] = c.correctedBU; });
        const allPins = { ...constants_1.PINNED_SENDERS, ...dynamicPins };
        const lastSyncRec = await (0, cosmos_1.query)(cosmos_1.CONTAINERS.EMAILS, 'SELECT TOP 10 c.lastSynced FROM c WHERE IS_DEFINED(c.lastSynced)').then(results => results.sort((a, b) => (b.lastSynced ?? '').localeCompare(a.lastSynced ?? '')));
        const sinceDate = lastSyncRec[0]?.lastSynced
            ? new Date(new Date(lastSyncRec[0].lastSynced).getTime() - 2 * 60 * 1000).toISOString()
            : new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        let skip = 0;
        let totalFetched = 0;
        let classified = 0;
        let errors = 0;
        let hasMore = true;
        while (hasMore && skip < PAGE_SIZE * MAX_PAGES) {
            const emails = await (0, graph_1.fetchRecentEmails)(ceoEmail, PAGE_SIZE, skip, sinceDate);
            context.log(`[emailSync] Page skip=${skip}: fetched ${emails.length} emails`);
            if (emails.length === 0) {
                hasMore = false;
                break;
            }
            for (const email of emails) {
                try {
                    const result = await (0, classifier_1.classifyEmail)(email, allPins);
                    const doc = {
                        id: email.id,
                        graphId: email.id,
                        subject: email.subject ?? '(no subject)',
                        from: { name: email.from?.emailAddress?.name ?? '', email: email.from?.emailAddress?.address ?? '' },
                        receivedDateTime: email.receivedDateTime,
                        isRead: email.isRead,
                        bu: result.bu,
                        tier: result.tier,
                        aiScore: result.aiScore,
                        tags: result.tags,
                        isVip: result.isVip,
                        isPinned: result.isPinned,
                        isInternal: result.isInternal,
                        summary: result.summary,
                        actionRequired: result.actionRequired,
                        suggestedDelegatee: result.suggestedDelegatee,
                        sentiment: result.sentiment,
                        status: 'active',
                        hasAttachments: email.hasAttachments,
                        bodyPreview: email.bodyPreview ?? '',
                        bodyContent: (email.body?.content ?? '').slice(0, 500000),
                        bodyContentType: email.body?.contentType ?? 'text',
                        lastSynced: new Date().toISOString(),
                    };
                    // Generate embedding for vector search
                    const embedText = (0, embed_1.buildEmailEmbedText)({
                        subject: doc.subject,
                        from: doc.from,
                        bu: doc.bu,
                        tags: doc.tags,
                        summary: doc.summary,
                        bodyPreview: doc.bodyPreview,
                    });
                    const embedding = await (0, embed_1.generateEmbedding)(embedText);
                    if (embedding.length > 0)
                        doc.embedding = embedding;
                    await (0, cosmos_1.upsert)(cosmos_1.CONTAINERS.EMAILS, doc);
                    classified++;
                }
                catch (err) {
                    context.error(`[emailSync] Failed to process email ${email.id}:`, err);
                    errors++;
                }
            }
            totalFetched += emails.length;
            skip += PAGE_SIZE;
            if (emails.length < PAGE_SIZE)
                hasMore = false;
        }
        context.log(`[emailSync] Done. Total: ${totalFetched}, Classified: ${classified}, Errors: ${errors}`);
    },
});
//# sourceMappingURL=index.js.map