import { Client } from '@microsoft/microsoft-graph-client';
import 'isomorphic-fetch';

// ── GET OAUTH2 TOKEN ──────────────────────────────────────
// IMPORTANT — CROSS-TENANT SETUP:
// Graph API tokens must be obtained from the O365 tenant (where ceo@iol.world lives),
// NOT from the Azure resources tenant (where Cosmos DB / Function App live).
// Use GRAPH_TENANT_ID for Graph calls. AZURE_TENANT_ID is only for SWA login.
async function getToken(): Promise<string> {
  const tenantId     = process.env.GRAPH_TENANT_ID!;   // O365 tenant
  const clientId     = process.env.GRAPH_CLIENT_ID!;   // App Reg in O365 tenant
  const clientSecret = process.env.GRAPH_CLIENT_SECRET!;

  const url = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    grant_type:    'client_credentials',
    client_id:     clientId,
    client_secret: clientSecret,
    scope:         'https://graph.microsoft.com/.default',
  });

  const res = await fetch(url, { method: 'POST', body });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Graph token error (tenant: ${tenantId}): ${err}`);
  }
  const json = await res.json() as { access_token: string };
  return json.access_token;
}

// ── GRAPH CLIENT ──────────────────────────────────────────
export async function graphClient(): Promise<Client> {
  const token = await getToken();
  return Client.init({
    authProvider: (done) => done(null, token),
  });
}

// ── FETCH EMAILS ──────────────────────────────────────────
export async function fetchRecentEmails(
  userEmail: string,
  top = 50,
  skip = 0,
  filterDate?: string
): Promise<GraphEmail[]> {
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
  return res.value as GraphEmail[];
}

// ── FETCH SINGLE EMAIL ────────────────────────────────────
export async function fetchEmailById(
  userEmail: string,
  emailId: string
): Promise<GraphEmail> {
  const client = await graphClient();
  return client
    .api(`/users/${userEmail}/messages/${emailId}`)
    .get() as Promise<GraphEmail>;
}

// ── FETCH ATTACHMENTS ────────────────────────────────────
export async function fetchAttachments(
  userEmail: string,
  emailId: string
): Promise<GraphAttachment[]> {
  const client = await graphClient();
  const res = await client
    .api(`/users/${userEmail}/messages/${emailId}/attachments`)
    .get();
  return res.value as GraphAttachment[];
}

// ── FETCH CALENDAR EVENTS ────────────────────────────────
// FIX: calendarView REQUIRES .query() for startDateTime/endDateTime.
// Inline URL params are silently dropped by the Graph SDK → empty results.
export async function fetchCalendarEvents(
  userEmail: string,
  startDate: string,
  endDate: string
): Promise<GraphEvent[]> {
  const client = await graphClient();
  const res = await client
    .api(`/users/${userEmail}/calendarView`)
    .query({ startDateTime: startDate, endDateTime: endDate })
    .top(20)
    .orderby('start/dateTime')
    .select('id,subject,start,end,location,attendees,organizer,isAllDay,showAs,importance,bodyPreview')
    .get();
  return res.value as GraphEvent[];
}

// ── FETCH TEAMS MESSAGES ─────────────────────────────────
// FIX: /users/{id}/chats does not support $orderby server-side.
// Sort client-side after fetching.
export async function fetchTeamsChats(userEmail: string): Promise<GraphTeamsMessage[]> {
  const client = await graphClient();

  const chats = await client
    .api(`/users/${userEmail}/chats`)
    .query({ $expand: 'members' })
    .top(10)
    .get();

  const messages: GraphTeamsMessage[] = [];

  for (const chat of (chats.value || []).slice(0, 10)) {
    try {
      const msgs = await client
        .api(`/chats/${chat.id}/messages`)
        .top(20)
        .get();
      (msgs.value || []).forEach((m: GraphTeamsMessage) => {
        if (!m.chatId) m.chatId = chat.id;
      });
      messages.push(...(msgs.value || []));
    } catch { /* skip chats we cannot read */ }
  }

  messages.sort((a, b) =>
    new Date(b.createdDateTime).getTime() - new Date(a.createdDateTime).getTime()
  );

  return messages;
}

// ── ARCHIVE EMAIL ─────────────────────────────────────────
export async function archiveEmail(userEmail: string, emailId: string): Promise<void> {
  const client = await graphClient();
  await client.api(`/users/${userEmail}/messages/${emailId}/move`).post({ destinationId: 'archive' });
}

// ── MARK EMAIL READ ───────────────────────────────────────
// BUG-005 FIX: PATCHes the message in Exchange/Outlook so the unread
// state is consistent across all clients (Outlook desktop, mobile, web).
// Without this, emailSync overwrites isRead=true back to false on next poll.
export async function markEmailRead(userEmail: string, emailId: string): Promise<void> {
  const client = await graphClient();
  await client
    .api(`/users/${userEmail}/messages/${emailId}`)
    .patch({ isRead: true });
}

// ── SEND TEAMS MESSAGE ────────────────────────────────────
export async function sendTeamsMessage(
  fromUserEmail: string,
  toUserEmail: string,
  content: string
): Promise<void> {
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
export async function registerWebhook(userEmail: string): Promise<string> {
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
  return sub.id as string;
}

// ── TYPES ─────────────────────────────────────────────────
export interface GraphEmail {
  id: string;
  subject: string;
  from: { emailAddress: { name: string; address: string } };
  toRecipients: Array<{ emailAddress: { name: string; address: string } }>;
  ccRecipients: Array<{ emailAddress: { name: string; address: string } }>;
  receivedDateTime: string;
  isRead: boolean;
  importance: string;
  hasAttachments: boolean;
  bodyPreview: string;
  body: { contentType: string; content: string };
  conversationId: string;
}

export interface GraphAttachment {
  id: string;
  name: string;
  contentType: string;
  size: number;
}

export interface GraphEvent {
  id: string;
  subject: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  location: { displayName: string };
  attendees: Array<{ emailAddress: { name: string; address: string }; status: { response: string } }>;
  organizer: { emailAddress: { name: string; address: string } };
  isAllDay: boolean;
  showAs: string;
  importance: string;
  bodyPreview: string;
}

export interface GraphTeamsMessage {
  id: string;
  createdDateTime: string;
  from: { user: { displayName: string; id: string } };
  body: { contentType: string; content: string };
  importance: string;
  chatId: string;
}

// ── TEAMS THREAD TYPE ─────────────────────────────────────
export interface TeamsThread {
  id: string;
  chatId: string;
  fromName: string;
  fromUserId: string;
  content: string;
  subject?: string;
  createdDateTime: string;
  importance: string;
}

// ── FETCH ALL TEAMS THREADS (cursor pagination) ───────────
// Uses @odata.nextLink to page through all results — no $skip limit.
export async function fetchAllTeamsThreads(userEmail: string, sinceDate?: string): Promise<TeamsThread[]> {
  const client = await graphClient();
  const cutoff = sinceDate ? new Date(sinceDate).getTime() : Date.now() - 30 * 24 * 60 * 60 * 1000;
  const threads: TeamsThread[] = [];

  // ── FETCH CHATS ───────────────────────────────────────────────────────────
  // NOTE: Do NOT use $expand=members — it causes 500s with app-only permissions.
  // Fetch chats list cleanly, then messages separately per chat.
  let hasMoreChats = true;
  let chatsNextLink: string | undefined;

  while (hasMoreChats) {
    let res: { value: Array<{ id: string }>; '@odata.nextLink'?: string };

    if (chatsNextLink) {
      res = await client.api(chatsNextLink).get();
    } else {
      res = await client
        .api(`/users/${userEmail}/chats`)
        .top(20)
        .get();
    }

    for (const chat of (res.value ?? [])) {
      try {
        // ── FETCH MESSAGES PER CHAT ─────────────────────────────────────────
        let hasMoreMsgs = true;
        let msgsNextLink: string | undefined;

        while (hasMoreMsgs) {
          let msgsRes: { value: Array<Record<string, unknown>>; '@odata.nextLink'?: string };

          if (msgsNextLink) {
            msgsRes = await client.api(msgsNextLink).get();
          } else {
            msgsRes = await client
              .api(`/chats/${chat.id}/messages`)
              .top(50)
              .get();
          }

          for (const m of (msgsRes.value ?? [])) {
            const created = m['createdDateTime'] as string | undefined;
            if (!created) continue;
            if (new Date(created).getTime() < cutoff) { hasMoreMsgs = false; break; }
            const from = m['from'] as { user?: { displayName?: string; id?: string } } | undefined;
            if (!from?.user) continue;
            const body = m['body'] as { content?: string } | undefined;
            threads.push({
              id:              m['id'] as string,
              chatId:          chat.id,
              fromName:        from.user.displayName ?? '',
              fromUserId:      from.user.id ?? '',
              content:         (body?.content ?? '').replace(/<[^>]+>/g, '').slice(0, 800),
              createdDateTime: created,
              importance:      (m['importance'] as string) ?? 'normal',
            });
          }

          msgsNextLink = msgsRes['@odata.nextLink'];
          if (!msgsNextLink) hasMoreMsgs = false;
        }
      } catch { /* skip chats we cannot read (e.g. group chats, deleted chats) */ }
    }

    chatsNextLink = res['@odata.nextLink'];
    if (!chatsNextLink) hasMoreChats = false;
  }

  return threads.sort((a, b) => new Date(b.createdDateTime).getTime() - new Date(a.createdDateTime).getTime());
}

// ── FETCH EMAIL PAGE FOR BACKFILL (nextLink pagination) ───
export async function fetchEmailPageForBackfill(
  userEmail: string,
  nextLink?: string,
  filterDate?: string
): Promise<{ emails: import('./graph').GraphEmail[]; nextLink?: string }> {
  const client = await graphClient();
  let req: ReturnType<typeof client.api>;

  if (nextLink) {
    req = client.api(nextLink);
  } else {
    req = client
      .api(`/users/${userEmail}/mailFolders/inbox/messages`)
      .top(50)
      .orderby('receivedDateTime asc')
      .select('id,subject,from,toRecipients,ccRecipients,receivedDateTime,isRead,importance,hasAttachments,bodyPreview,body,conversationId');
    if (filterDate) req = req.filter(`receivedDateTime ge ${filterDate}`);
  }

  const res = await req.get();
  return {
    emails:   res.value as import('./graph').GraphEmail[],
    nextLink: res['@odata.nextLink'],
  };
}

// ── FETCH SENT PAGE FOR BACKFILL (nextLink pagination) ────
export async function fetchSentPageForBackfill(
  userEmail: string,
  nextLink?: string,
  filterDate?: string
): Promise<{ emails: import('./graph').GraphEmail[]; nextLink?: string }> {
  const client = await graphClient();
  let req: ReturnType<typeof client.api>;

  if (nextLink) {
    req = client.api(nextLink);
  } else {
    req = client
      .api(`/users/${userEmail}/mailFolders/sentItems/messages`)
      .top(50)
      .orderby('sentDateTime asc')
      .select('id,subject,from,toRecipients,ccRecipients,receivedDateTime,isRead,importance,hasAttachments,bodyPreview,body,conversationId');
    if (filterDate) req = req.filter(`sentDateTime ge ${filterDate}`);
  }

  const res = await req.get();
  return {
    emails:   res.value as import('./graph').GraphEmail[],
    nextLink: res['@odata.nextLink'],
  };
}
