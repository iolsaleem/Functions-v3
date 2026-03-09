"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.graphClient = graphClient;
exports.fetchRecentEmails = fetchRecentEmails;
exports.fetchEmailById = fetchEmailById;
exports.fetchAttachments = fetchAttachments;
exports.fetchCalendarEvents = fetchCalendarEvents;
exports.fetchTeamsChats = fetchTeamsChats;
exports.archiveEmail = archiveEmail;
exports.markEmailRead = markEmailRead;
exports.sendTeamsMessage = sendTeamsMessage;
exports.registerWebhook = registerWebhook;
exports.fetchAllTeamsThreads = fetchAllTeamsThreads;
exports.fetchEmailPageForBackfill = fetchEmailPageForBackfill;
exports.fetchSentPageForBackfill = fetchSentPageForBackfill;
const microsoft_graph_client_1 = require("@microsoft/microsoft-graph-client");
require("isomorphic-fetch");
// ── GET OAUTH2 TOKEN ──────────────────────────────────────
// IMPORTANT — CROSS-TENANT SETUP:
// Graph API tokens must be obtained from the O365 tenant (where ceo@iol.world lives),
// NOT from the Azure resources tenant (where Cosmos DB / Function App live).
// Use GRAPH_TENANT_ID for Graph calls. AZURE_TENANT_ID is only for SWA login.
async function getToken() {
    const tenantId = process.env.GRAPH_TENANT_ID; // O365 tenant
    const clientId = process.env.GRAPH_CLIENT_ID; // App Reg in O365 tenant
    const clientSecret = process.env.GRAPH_CLIENT_SECRET;
    const url = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
    const body = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
        scope: 'https://graph.microsoft.com/.default',
    });
    const res = await fetch(url, { method: 'POST', body });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Graph token error (tenant: ${tenantId}): ${err}`);
    }
    const json = await res.json();
    return json.access_token;
}
// ── GRAPH CLIENT ──────────────────────────────────────────
async function graphClient() {
    const token = await getToken();
    return microsoft_graph_client_1.Client.init({
        authProvider: (done) => done(null, token),
    });
}
// ── FETCH EMAILS ──────────────────────────────────────────
async function fetchRecentEmails(userEmail, top = 50, skip = 0, filterDate) {
    const client = await graphClient();
    let req = client
        .api(`/users/${userEmail}/mailFolders/inbox/messages`)
        .top(top)
        .skip(skip)
        .orderby('receivedDateTime desc')
        .select('id,subject,from,toRecipients,ccRecipients,receivedDateTime,isRead,importance,hasAttachments,bodyPreview,body,conversationId');
    if (filterDate) {
        req = req.filter(`receivedDateTime ge ${filterDate}`);
    }
    const res = await req.get();
    return res.value;
}
// ── FETCH SINGLE EMAIL ────────────────────────────────────
async function fetchEmailById(userEmail, emailId) {
    const client = await graphClient();
    return client
        .api(`/users/${userEmail}/messages/${emailId}`)
        .get();
}
// ── FETCH ATTACHMENTS ────────────────────────────────────
async function fetchAttachments(userEmail, emailId) {
    const client = await graphClient();
    const res = await client
        .api(`/users/${userEmail}/messages/${emailId}/attachments`)
        .get();
    return res.value;
}
// ── FETCH CALENDAR EVENTS ────────────────────────────────
// FIX: calendarView REQUIRES .query() for startDateTime/endDateTime.
// Inline URL params are silently dropped by the Graph SDK → empty results.
async function fetchCalendarEvents(userEmail, startDate, endDate) {
    const client = await graphClient();
    const res = await client
        .api(`/users/${userEmail}/calendarView`)
        .query({ startDateTime: startDate, endDateTime: endDate })
        .top(20)
        .orderby('start/dateTime')
        .select('id,subject,start,end,location,attendees,organizer,isAllDay,showAs,importance,bodyPreview')
        .get();
    return res.value;
}
// ── FETCH TEAMS MESSAGES ─────────────────────────────────
// FIX: /users/{id}/chats does not support $orderby server-side.
// Sort client-side after fetching.
async function fetchTeamsChats(userEmail) {
    const client = await graphClient();
    const chats = await client
        .api(`/users/${userEmail}/chats`)
        .query({ $expand: 'members' })
        .top(10)
        .get();
    const messages = [];
    for (const chat of (chats.value || []).slice(0, 10)) {
        try {
            const msgs = await client
                .api(`/chats/${chat.id}/messages`)
                .top(20)
                .get();
            (msgs.value || []).forEach((m) => {
                if (!m.chatId)
                    m.chatId = chat.id;
            });
            messages.push(...(msgs.value || []));
        }
        catch { /* skip chats we cannot read */ }
    }
    messages.sort((a, b) => new Date(b.createdDateTime).getTime() - new Date(a.createdDateTime).getTime());
    return messages;
}
// ── ARCHIVE EMAIL ─────────────────────────────────────────
async function archiveEmail(userEmail, emailId) {
    const client = await graphClient();
    await client.api(`/users/${userEmail}/messages/${emailId}/move`).post({ destinationId: 'archive' });
}
// ── MARK EMAIL READ ───────────────────────────────────────
// BUG-005 FIX: PATCHes the message in Exchange/Outlook so the unread
// state is consistent across all clients (Outlook desktop, mobile, web).
// Without this, emailSync overwrites isRead=true back to false on next poll.
async function markEmailRead(userEmail, emailId) {
    const client = await graphClient();
    await client
        .api(`/users/${userEmail}/messages/${emailId}`)
        .patch({ isRead: true });
}
// ── SEND TEAMS MESSAGE ────────────────────────────────────
async function sendTeamsMessage(fromUserEmail, toUserEmail, content) {
    const client = await graphClient();
    const chat = await client.api('/chats').post({
        chatType: 'oneOnOne',
        members: [
            { '@odata.type': '#microsoft.graph.aadUserConversationMember', roles: ['owner'], 'user@odata.bind': `https://graph.microsoft.com/v1.0/users/${fromUserEmail}` },
            { '@odata.type': '#microsoft.graph.aadUserConversationMember', roles: ['owner'], 'user@odata.bind': `https://graph.microsoft.com/v1.0/users/${toUserEmail}` },
        ],
    });
    await client.api(`/chats/${chat.id}/messages`).post({
        body: { contentType: 'html', content },
    });
}
// ── REGISTER WEBHOOK ──────────────────────────────────────
async function registerWebhook(userEmail) {
    const client = await graphClient();
    const GRAPH_MAIL_MAX_EXPIRY_MINUTES = 4230;
    const expiry = new Date(Date.now() + GRAPH_MAIL_MAX_EXPIRY_MINUTES * 60 * 1000);
    const sub = await client.api('/subscriptions').post({
        changeType: 'created,updated',
        notificationUrl: process.env.GRAPH_NOTIFICATION_URL,
        resource: `/users/${userEmail}/mailFolders/inbox/messages`,
        expirationDateTime: expiry.toISOString(),
        clientState: process.env.GRAPH_WEBHOOK_SECRET,
    });
    return sub.id;
}
// ── FETCH ALL TEAMS THREADS (cursor pagination) ───────────
// Uses @odata.nextLink to page through all results — no $skip limit.
async function fetchAllTeamsThreads(userEmail, sinceDate) {
    const client = await graphClient();
    const cutoff = sinceDate ? new Date(sinceDate).getTime() : Date.now() - 30 * 24 * 60 * 60 * 1000;
    const threads = [];
    // ── FETCH CHATS ───────────────────────────────────────────────────────────
    // NOTE: Do NOT use $expand=members — it causes 500s with app-only permissions.
    // Fetch chats list cleanly, then messages separately per chat.
    let hasMoreChats = true;
    let chatsNextLink;
    while (hasMoreChats) {
        let res;
        if (chatsNextLink) {
            res = await client.api(chatsNextLink).get();
        }
        else {
            res = await client
                .api(`/users/${userEmail}/chats`)
                .top(20)
                .get();
        }
        for (const chat of (res.value ?? [])) {
            try {
                // ── FETCH MESSAGES PER CHAT ─────────────────────────────────────────
                let hasMoreMsgs = true;
                let msgsNextLink;
                while (hasMoreMsgs) {
                    let msgsRes;
                    if (msgsNextLink) {
                        msgsRes = await client.api(msgsNextLink).get();
                    }
                    else {
                        msgsRes = await client
                            .api(`/chats/${chat.id}/messages`)
                            .top(50)
                            .get();
                    }
                    for (const m of (msgsRes.value ?? [])) {
                        const created = m['createdDateTime'];
                        if (!created)
                            continue;
                        if (new Date(created).getTime() < cutoff) {
                            hasMoreMsgs = false;
                            break;
                        }
                        const from = m['from'];
                        if (!from?.user)
                            continue;
                        const body = m['body'];
                        threads.push({
                            id: m['id'],
                            chatId: chat.id,
                            fromName: from.user.displayName ?? '',
                            fromUserId: from.user.id ?? '',
                            content: (body?.content ?? '').replace(/<[^>]+>/g, '').slice(0, 800),
                            createdDateTime: created,
                            importance: m['importance'] ?? 'normal',
                        });
                    }
                    msgsNextLink = msgsRes['@odata.nextLink'];
                    if (!msgsNextLink)
                        hasMoreMsgs = false;
                }
            }
            catch { /* skip chats we cannot read (e.g. group chats, deleted chats) */ }
        }
        chatsNextLink = res['@odata.nextLink'];
        if (!chatsNextLink)
            hasMoreChats = false;
    }
    return threads.sort((a, b) => new Date(b.createdDateTime).getTime() - new Date(a.createdDateTime).getTime());
}
// ── FETCH EMAIL PAGE FOR BACKFILL (nextLink pagination) ───
async function fetchEmailPageForBackfill(userEmail, nextLink, filterDate) {
    const client = await graphClient();
    let req;
    if (nextLink) {
        req = client.api(nextLink);
    }
    else {
        req = client
            .api(`/users/${userEmail}/mailFolders/inbox/messages`)
            .top(50)
            .orderby('receivedDateTime asc')
            .select('id,subject,from,toRecipients,ccRecipients,receivedDateTime,isRead,importance,hasAttachments,bodyPreview,body,conversationId');
        if (filterDate)
            req = req.filter(`receivedDateTime ge ${filterDate}`);
    }
    const res = await req.get();
    return {
        emails: res.value,
        nextLink: res['@odata.nextLink'],
    };
}
// ── FETCH SENT PAGE FOR BACKFILL (nextLink pagination) ────
async function fetchSentPageForBackfill(userEmail, nextLink, filterDate) {
    const client = await graphClient();
    let req;
    if (nextLink) {
        req = client.api(nextLink);
    }
    else {
        req = client
            .api(`/users/${userEmail}/mailFolders/sentItems/messages`)
            .top(50)
            .orderby('sentDateTime asc')
            .select('id,subject,from,toRecipients,ccRecipients,receivedDateTime,isRead,importance,hasAttachments,bodyPreview,body,conversationId');
        if (filterDate)
            req = req.filter(`sentDateTime ge ${filterDate}`);
    }
    const res = await req.get();
    return {
        emails: res.value,
        nextLink: res['@odata.nextLink'],
    };
}
//# sourceMappingURL=graph.js.map