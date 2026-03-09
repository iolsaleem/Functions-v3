"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const functions_1 = require("@azure/functions");
const graph_1 = require("../shared/graph");
const rbac_1 = require("../shared/rbac");
functions_1.app.http('getEmailById', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'email/{id}',
    handler: async (req, context) => {
        const caller = await (0, rbac_1.validateRequest)(req);
        if (!caller)
            return { status: 401, body: 'Unauthorized' };
        const emailId = req.params.id;
        if (!emailId)
            return { status: 400, body: 'Email ID required' };
        const ceoEmail = process.env.CEO_EMAIL || 'ceo@iol.world';
        try {
            // Fetch full email body and attachments in parallel from Graph API
            const [email, attachments] = await Promise.allSettled([
                (0, graph_1.fetchEmailById)(ceoEmail, emailId),
                (0, graph_1.fetchAttachments)(ceoEmail, emailId),
            ]);
            if (email.status === 'rejected') {
                context.error('[getEmailById] Graph fetch failed:', email.reason);
                return { status: 404, body: JSON.stringify({ error: 'Email not found', detail: String(email.reason) }) };
            }
            const e = email.value;
            const atts = attachments.status === 'fulfilled' ? attachments.value : [];
            return {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: e.id,
                    subject: e.subject,
                    from: e.from,
                    toRecipients: e.toRecipients,
                    ccRecipients: e.ccRecipients,
                    receivedDateTime: e.receivedDateTime,
                    isRead: e.isRead,
                    importance: e.importance,
                    bodyContentType: e.body?.contentType ?? 'text',
                    bodyContent: e.body?.content ?? '',
                    hasAttachments: e.hasAttachments,
                    attachments: atts.map(a => ({
                        id: a.id,
                        name: a.name,
                        contentType: a.contentType,
                        size: a.size,
                    })),
                }),
            };
        }
        catch (err) {
            context.error('[getEmailById] Error:', err);
            return { status: 500, body: JSON.stringify({ error: 'Failed to fetch email', detail: String(err) }) };
        }
    },
});
//# sourceMappingURL=index.js.map