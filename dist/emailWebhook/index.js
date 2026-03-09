"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const functions_1 = require("@azure/functions");
const graph_1 = require("../shared/graph");
const classifier_1 = require("../shared/classifier");
const cosmos_1 = require("../shared/cosmos");
const embed_1 = require("../shared/embed");
const MAX_NOTIFICATION_AGE_MS = 5 * 60 * 1000;
functions_1.app.http('emailWebhook', {
    methods: ['POST', 'GET'],
    authLevel: 'anonymous',
    route: 'emailWebhook',
    handler: async (req, context) => {
        // ── VALIDATION HANDSHAKE ──────────────────────────────
        const validationToken = req.query.get('validationToken');
        if (validationToken) {
            context.log('[webhook] Validation handshake — echoing token');
            return { status: 200, headers: { 'Content-Type': 'text/plain' }, body: validationToken };
        }
        let body;
        try {
            body = await req.json();
        }
        catch {
            context.warn('[webhook] Received non-JSON body — ignoring');
            return { status: 202 };
        }
        const secret = process.env.GRAPH_WEBHOOK_SECRET;
        if (!secret) {
            context.error('[webhook] GRAPH_WEBHOOK_SECRET not configured');
            return { status: 202 };
        }
        let validCount = 0;
        let rejectedCount = 0;
        for (const notif of body.value ?? []) {
            if (notif.clientState !== secret) {
                rejectedCount++;
                context.warn(`[webhook] REJECTED: clientState mismatch`);
                continue;
            }
            if (notif.activityDateTime) {
                const ageMs = Math.abs(Date.now() - new Date(notif.activityDateTime).getTime());
                if (ageMs > MAX_NOTIFICATION_AGE_MS) {
                    rejectedCount++;
                    context.warn(`[webhook] REJECTED: notification too old (${Math.round(ageMs / 1000)}s)`);
                    continue;
                }
            }
            validCount++;
            const emailId = notif.resourceData?.id;
            if (!emailId) {
                context.warn('[webhook] No resourceData.id — skipping');
                continue;
            }
            context.log(`[webhook] Processing notification for email: ${emailId}`);
            try {
                const ceoEmail = process.env.CEO_EMAIL || 'ceo@iol.world';
                const email = await (0, graph_1.fetchEmailById)(ceoEmail, emailId);
                const result = await (0, classifier_1.classifyEmail)(email);
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
                context.log(`[webhook] Email ${emailId} classified → Tier ${result.tier}, BU: ${result.bu}`);
            }
            catch (err) {
                context.error(`[webhook] Failed to process email ${emailId}:`, err);
            }
        }
        if (rejectedCount > 0) {
            context.warn(`[webhook] Batch: ${validCount} valid, ${rejectedCount} rejected`);
        }
        return { status: 202 };
    },
});
//# sourceMappingURL=index.js.map