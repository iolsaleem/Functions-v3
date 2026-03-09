"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const functions_1 = require("@azure/functions");
const graph_1 = require("../shared/graph");
const monday_1 = require("../shared/monday");
const cosmos_1 = require("../shared/cosmos");
const rbac_1 = require("../shared/rbac");
functions_1.app.http('delegateAction', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'email/delegate',
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
        const { emailId, delegateToEmail, note } = body;
        if (!emailId || !delegateToEmail) {
            return { status: 400, body: 'emailId and delegateToEmail required' };
        }
        const ceoEmail = process.env.CEO_EMAIL || 'ceo@iol.world';
        context.log(`[delegate] ${emailId} → ${delegateToEmail}`);
        const email = await (0, cosmos_1.getById)(cosmos_1.CONTAINERS.EMAILS, emailId);
        if (!email)
            return { status: 404, body: 'Email not found' };
        const delegateUser = await (0, rbac_1.loadUser)(delegateToEmail);
        const now = new Date().toISOString();
        // 1. Mark delegated in Cosmos
        await (0, cosmos_1.upsert)(cosmos_1.CONTAINERS.EMAILS, {
            ...email,
            status: 'delegated',
            delegatedTo: delegateToEmail,
            delegatedAt: now,
        });
        // 2. Send Teams DM
        const emailFrom = email.from;
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
            await (0, graph_1.sendTeamsMessage)(ceoEmail, delegateToEmail, teamsMsg);
            teamsSent = true;
            context.log(`[delegate] Teams DM sent to ${delegateToEmail}`);
        }
        catch (err) {
            context.warn('[delegate] Teams DM failed:', err);
        }
        // 3. Monday.com task (graceful — won't break if unconfigured)
        const mondayResult = await (0, monday_1.createMondayTask)({
            bu: email.bu,
            title: `[Delegated] ${email.subject}`,
            description: `Delegated by fM on ${new Date().toLocaleDateString()}\n\nFrom: ${emailFrom.name}\nSummary: ${email.summary}\n${email.actionRequired ? `Action: ${email.actionRequired}` : ''}`,
            assigneeEmail: delegateToEmail,
            emailSubject: email.subject,
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
//# sourceMappingURL=index.js.map