import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { sendTeamsMessage } from '../shared/graph';
import { createMondayTask } from '../shared/monday';
import { upsert, getById, CONTAINERS } from '../shared/cosmos';
import { validateRequest, loadUser } from '../shared/rbac';

interface DelegateRequest {
  emailId: string;
  delegateToEmail: string;
  note?: string;
}

app.http('delegateAction', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'email/delegate',
  handler: async (req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    const caller = await validateRequest(req);
    if (!caller) {
      return { status: 401, body: 'Unauthorized' };
    }

    let body: DelegateRequest;
    try {
      body = await req.json() as DelegateRequest;
    } catch {
      return { status: 400, body: 'Invalid JSON' };
    }

    const { emailId, delegateToEmail, note } = body;
    if (!emailId || !delegateToEmail) {
      return { status: 400, body: 'emailId and delegateToEmail required' };
    }

    const ceoEmail = process.env.CEO_EMAIL || 'ceo@iol.world';
    context.log(`[delegate] ${emailId} → ${delegateToEmail}`);

    const email = await getById<{ id: string } & Record<string, unknown>>(CONTAINERS.EMAILS, emailId);
    if (!email) return { status: 404, body: 'Email not found' };

    const delegateUser = await loadUser(delegateToEmail);
    const now = new Date().toISOString();

    // 1. Mark delegated in Cosmos
    await upsert(CONTAINERS.EMAILS, {
      ...email,
      status: 'delegated',
      delegatedTo: delegateToEmail,
      delegatedAt: now,
    });

    // 2. Send Teams DM
    const emailFrom = (email.from as { name: string; email: string });
    const teamsMsg = `
<b>📨 Delegated to you by Faisal</b><br><br>
<b>From:</b> ${emailFrom.name} (${emailFrom.email})<br>
<b>Subject:</b> ${email.subject}<br>
<b>BU:</b> ${email.bu}<br>
<b>Summary:</b> ${email.summary}<br>
${email.actionRequired ? `<b>Action Required:</b> ${email.actionRequired}<br>` : ''}
${note ? `<b>Note from fM:</b> ${note}<br>` : ''}
<br>
<i>Please handle and update Monday.com accordingly.</i>
    `.trim();

    let teamsSent = false;
    try {
      await sendTeamsMessage(ceoEmail, delegateToEmail, teamsMsg);
      teamsSent = true;
      context.log(`[delegate] Teams DM sent to ${delegateToEmail}`);
    } catch (err) {
      context.warn('[delegate] Teams DM failed:', err);
    }

    // 3. Monday.com task (graceful — won't break if unconfigured)
    const mondayResult = await createMondayTask({
      bu: email.bu as import('../shared/constants').BU,
      title: `[Delegated] ${email.subject}`,
      description: `Delegated by fM on ${new Date().toLocaleDateString()}\n\nFrom: ${emailFrom.name}\nSummary: ${email.summary}\n${email.actionRequired ? `Action: ${email.actionRequired}` : ''}`,
      assigneeEmail: delegateToEmail,
      emailSubject: email.subject as string,
      emailId: emailId,
    });

    context.log(`[delegate] Monday result: ${JSON.stringify(mondayResult)}`);

    return {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        emailId,
        delegatedTo: delegateToEmail,
        delegateName: delegateUser?.displayName ?? delegateToEmail,
        teamsSent,
        mondayTask: mondayResult,
      }),
    };
  },
});
