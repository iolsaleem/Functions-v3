import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { validateRequest } from '../shared/rbac';
import { fetchCalendarEvents } from '../shared/graph';

app.http('getCalendar', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'calendar',
  handler: async (req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    const caller = await validateRequest(req);
    if (!caller) return { status: 401, body: 'Unauthorized' };

    const ceoEmail = process.env.CEO_EMAIL || 'ceo@iol.world';
    const now = new Date();
    const sevenDays = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    try {
      const events = await fetchCalendarEvents(ceoEmail, now.toISOString(), sevenDays.toISOString());
      return {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events }),
      };
    } catch (err) {
      context.error('[getCalendar] Error:', err);
      return { status: 500, body: JSON.stringify({ error: 'Calendar fetch failed' }) };
    }
  },
});
