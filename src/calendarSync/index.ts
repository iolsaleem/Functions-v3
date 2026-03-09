import { app, Timer, InvocationContext } from '@azure/functions';
import { fetchCalendarEvents } from '../shared/graph';
import { upsert, CONTAINERS } from '../shared/cosmos';
import { generateEmbedding, buildCalendarEmbedText } from '../shared/embed';

interface StoredCalendarEvent {
  id: string;
  subject: string;
  start: string;
  end: string;
  location: string;
  attendees: string[];
  organizer: string;
  isAllDay: boolean;
  showAs: string;
  importance: string;
  bodyPreview: string;
  teamsDeepLink?: string;
  outlookDeepLink: string;
  embedding?: number[];
  syncedAt: string;
}

app.timer('calendarSync', {
  schedule: '0 */2 * * * *',   // every 2 minutes
  runOnStartup: true,
  handler: async (_timer: Timer, context: InvocationContext) => {
    context.log('[calendarSync] Starting calendar sync...');

    const ceoEmail = process.env.CEO_EMAIL || 'ceo@iol.world';
    const now      = new Date();
    const start    = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(); // -24h
    const end      = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(); // +24h

    let processed = 0;
    let errors    = 0;

    try {
      const events = await fetchCalendarEvents(ceoEmail, start, end);
      context.log(`[calendarSync] Fetched ${events.length} events`);

      for (const event of events) {
        try {
          const attendeeNames = (event.attendees ?? [])
            .map(a => a.emailAddress?.name ?? a.emailAddress?.address ?? '')
            .filter(Boolean);

          const doc: StoredCalendarEvent = {
            id:          event.id,
            subject:     event.subject ?? '(no subject)',
            start:       event.start?.dateTime ?? '',
            end:         event.end?.dateTime ?? '',
            location:    event.location?.displayName ?? '',
            attendees:   attendeeNames,
            organizer:   event.organizer?.emailAddress?.name ?? '',
            isAllDay:    event.isAllDay ?? false,
            showAs:      event.showAs ?? 'busy',
            importance:  event.importance ?? 'normal',
            bodyPreview: event.bodyPreview ?? '',
            // Deep links for opening directly in Outlook / Teams
            outlookDeepLink: `https://outlook.office.com/calendar/item/${encodeURIComponent(event.id)}`,
            syncedAt:    new Date().toISOString(),
          };

          // Generate embedding for vector search
          const embedText = buildCalendarEmbedText({
            subject:     doc.subject,
            start:       doc.start,
            location:    doc.location,
            attendees:   doc.attendees,
            bodyPreview: doc.bodyPreview,
          });
          const embedding = await generateEmbedding(embedText);
          if (embedding.length > 0) doc.embedding = embedding;

          await upsert(CONTAINERS.CALENDAR_EVENTS, doc);
          processed++;
        } catch (err) {
          context.error(`[calendarSync] Failed event ${event.id}:`, err);
          errors++;
        }
      }
    } catch (err) {
      context.error('[calendarSync] Fatal error fetching events:', err);
    }

    context.log(`[calendarSync] Done. Processed: ${processed}, Errors: ${errors}`);
  },
});
