import { app, Timer, InvocationContext } from '@azure/functions';
import { fetchCalendarEvents } from '../shared/graph';
import { generateDailyBrief } from '../shared/classifier';
import { query, upsert, CONTAINERS } from '../shared/cosmos';

// ── TIMER: 06:00 GST = 02:00 UTC ─────────────────────────
app.timer('morningBrief', {
  schedule: '0 0 2 * * *',
  handler: async (_timer: Timer, context: InvocationContext) => {
    context.log('[morningBrief] Generating daily brief...');
    const ceoEmail = process.env.CEO_EMAIL || 'ceo@iol.world';
    const today = new Date();
    const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);

    // Fetch active emails from last 24h needing attention
    const emails = await query<{
      subject: string; from: { name: string; email: string };
      summary: string; tags: string[]; bu: string; actionRequired: string; receivedDateTime: string;
    }>(
      CONTAINERS.EMAILS,
      `SELECT TOP 20 c.subject, c.from, c.summary, c.tags, c.bu, c.actionRequired, c.receivedDateTime
       FROM c WHERE c.status = 'active' AND c.tier = 1`
    ).then(results => results.sort((a, b) => (b.receivedDateTime ?? '').localeCompare(a.receivedDateTime ?? '')));

    // Fetch today's calendar
    const calEvents = await fetchCalendarEvents(
      ceoEmail,
      today.toISOString(),
      tomorrow.toISOString()
    );

    const emailsForBrief = emails.map(e => ({
      subject: e.subject,
      from: e.from?.name ?? e.from?.email ?? '',
      summary: e.summary,
      tags: e.tags ?? [],
    }));

    const calForBrief = calEvents.map(e => ({
      subject: e.subject,
      start: e.start?.dateTime ?? '',
      end: e.end?.dateTime ?? '',
    }));

    const briefText = await generateDailyBrief(emailsForBrief, calForBrief);

    const doc = {
      id: `brief-${today.toISOString().split('T')[0]}`,
      date: today.toISOString().split('T')[0],
      text: briefText,
      emailCount: emails.length,
      calendarCount: calEvents.length,
      generatedAt: new Date().toISOString(),
    };

    await upsert(CONTAINERS.BRIEFS, doc);
    context.log('[morningBrief] Brief generated and stored');
  },
});
