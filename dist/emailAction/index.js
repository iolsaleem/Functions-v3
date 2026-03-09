"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const functions_1 = require("@azure/functions");
const graph_1 = require("../shared/graph");
const cosmos_1 = require("../shared/cosmos");
const rbac_1 = require("../shared/rbac");
functions_1.app.http('emailAction', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'email/action',
    handler: async (req, context) => {
        const caller = await (0, rbac_1.validateRequest)(req);
        if (!caller) {
            return { status: 401, body: 'Unauthorized' };
        }
        let body;
        try {
            body = await req.json();
        }
        catch {
            return { status: 400, body: 'Invalid JSON' };
        }
        const { emailId, action } = body;
        if (!emailId || !action)
            return { status: 400, body: 'emailId and action required' };
        context.log(`[emailAction] ${action} on ${emailId}`);
        const ceoEmail = process.env.CEO_EMAIL || 'ceo@iol.world';
        const existing = await (0, cosmos_1.getById)(cosmos_1.CONTAINERS.EMAILS, emailId);
        if (!existing)
            return { status: 404, body: 'Email not found' };
        const now = new Date().toISOString();
        switch (action) {
            case 'done':
                await (0, cosmos_1.upsert)(cosmos_1.CONTAINERS.EMAILS, { ...existing, status: 'done', doneAt: now });
                break;
            case 'archive':
                await (0, cosmos_1.upsert)(cosmos_1.CONTAINERS.EMAILS, { ...existing, status: 'archived', archivedAt: now });
                try {
                    await (0, graph_1.archiveEmail)(ceoEmail, emailId);
                }
                catch (err) {
                    context.warn('[emailAction] Graph archive failed (still marked archived locally):', err);
                }
                break;
            case 'snooze':
                if (!body.snoozeUntil)
                    return { status: 400, body: 'snoozeUntil required for snooze action' };
                await (0, cosmos_1.upsert)(cosmos_1.CONTAINERS.EMAILS, { ...existing, status: 'snoozed', snoozedUntil: body.snoozeUntil });
                break;
            case 'escalate':
                await (0, cosmos_1.upsert)(cosmos_1.CONTAINERS.EMAILS, { ...existing, status: 'escalated', escalatedAt: now, tags: [...(existing.tags || []), 'urgent'] });
                break;
            case 'correctBU':
                if (!body.correctedBU)
                    return { status: 400, body: 'correctedBU required' };
                await (0, cosmos_1.upsert)(cosmos_1.CONTAINERS.EMAILS, { ...existing, bu: body.correctedBU, isPinned: true });
                // Write to classifier corrections for learning loop
                await (0, cosmos_1.upsert)(cosmos_1.CONTAINERS.CLASSIFIER, {
                    id: `pin-${existing.from.email}-${Date.now()}`,
                    type: 'pinned',
                    senderEmail: existing.from.email,
                    correctedBU: body.correctedBU,
                    originalBU: existing.bu,
                    correctedBy: ceoEmail,
                    timestamp: now,
                });
                break;
            case 'surface':
                await (0, cosmos_1.upsert)(cosmos_1.CONTAINERS.EMAILS, { ...existing, tier: 1, aiScore: 85, status: 'active' });
                break;
            case 'markRead':
                // ── BUG-005 FIX: update Cosmos AND sync to Outlook via Graph PATCH ──
                await (0, cosmos_1.upsert)(cosmos_1.CONTAINERS.EMAILS, { ...existing, isRead: true });
                try {
                    await (0, graph_1.markEmailRead)(ceoEmail, emailId);
                }
                catch (err) {
                    // Non-fatal: local state is updated; Graph sync is best-effort
                    context.warn('[emailAction] Graph markRead failed (local state updated):', err);
                }
                break;
            default:
                return { status: 400, body: `Unknown action: ${action}` };
        }
        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ success: true, action, emailId }),
        };
    },
});
//# sourceMappingURL=index.js.map