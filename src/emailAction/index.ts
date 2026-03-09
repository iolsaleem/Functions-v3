import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { archiveEmail, markEmailRead } from '../shared/graph';
import { upsert, getById, CONTAINERS } from '../shared/cosmos';
import { validateRequest } from '../shared/rbac';

type ActionType = 'done' | 'archive' | 'snooze' | 'escalate' | 'correctBU' | 'surface' | 'markRead';

interface ActionRequest {
  emailId: string;
  action: ActionType;
  snoozeUntil?: string;   // ISO date for snooze
  correctedBU?: string;   // for correctBU
}

app.http('emailAction', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'email/action',
  handler: async (req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    const caller = await validateRequest(req);
    if (!caller) {
      return { status: 401, body: 'Unauthorized' };
    }

    let body: ActionRequest;
    try {
      body = await req.json() as ActionRequest;
    } catch {
      return { status: 400, body: 'Invalid JSON' };
    }

    const { emailId, action } = body;
    if (!emailId || !action) return { status: 400, body: 'emailId and action required' };

    context.log(`[emailAction] ${action} on ${emailId}`);
    const ceoEmail = process.env.CEO_EMAIL || 'ceo@iol.world';

    const existing = await getById<{ id: string } & Record<string, unknown>>(CONTAINERS.EMAILS, emailId);
    if (!existing) return { status: 404, body: 'Email not found' };

    const now = new Date().toISOString();

    switch (action) {
      case 'done':
        await upsert(CONTAINERS.EMAILS, { ...existing, status: 'done', doneAt: now });
        break;

      case 'archive':
        await upsert(CONTAINERS.EMAILS, { ...existing, status: 'archived', archivedAt: now });
        try {
          await archiveEmail(ceoEmail, emailId);
        } catch (err) {
          context.warn('[emailAction] Graph archive failed (still marked archived locally):', err);
        }
        break;

      case 'snooze':
        if (!body.snoozeUntil) return { status: 400, body: 'snoozeUntil required for snooze action' };
        await upsert(CONTAINERS.EMAILS, { ...existing, status: 'snoozed', snoozedUntil: body.snoozeUntil });
        break;

      case 'escalate':
        await upsert(CONTAINERS.EMAILS, { ...existing, status: 'escalated', escalatedAt: now, tags: [...((existing.tags as string[]) || []), 'urgent'] });
        break;

      case 'correctBU':
        if (!body.correctedBU) return { status: 400, body: 'correctedBU required' };
        await upsert(CONTAINERS.EMAILS, { ...existing, bu: body.correctedBU, isPinned: true });
        // Write to classifier corrections for learning loop
        await upsert(CONTAINERS.CLASSIFIER, {
          id: `pin-${(existing.from as { email: string }).email}-${Date.now()}`,
          type: 'pinned',
          senderEmail: (existing.from as { email: string }).email,
          correctedBU: body.correctedBU,
          originalBU: existing.bu,
          correctedBy: ceoEmail,
          timestamp: now,
        });
        break;

      case 'surface':
        await upsert(CONTAINERS.EMAILS, { ...existing, tier: 1, aiScore: 85, status: 'active' });
        break;

      case 'markRead':
        // ── BUG-005 FIX: update Cosmos AND sync to Outlook via Graph PATCH ──
        await upsert(CONTAINERS.EMAILS, { ...existing, isRead: true });
        try {
          await markEmailRead(ceoEmail, emailId);
        } catch (err) {
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
