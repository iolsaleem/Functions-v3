import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { validateRequest } from '../shared/rbac';
import { query, CONTAINERS } from '../shared/cosmos';

app.http('getMorningBrief', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'brief/today',
  handler: async (req: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> => {
    const caller = await validateRequest(req);
    if (!caller) return { status: 401, body: 'Unauthorized' };

    const today = new Date().toISOString().split('T')[0];
    const briefs = await query<{ text: string; date: string; generatedAt: string }>(
      CONTAINERS.BRIEFS,
      `SELECT TOP 10 c.text, c.date, c.generatedAt FROM c WHERE c.date = '${today}'`
    ).then(results => results.sort((a, b) => (b.generatedAt ?? '').localeCompare(a.generatedAt ?? '')));

    if (briefs.length === 0) {
      return { status: 404, body: JSON.stringify({ message: 'not_ready' }) };
    }

    return {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(briefs[0]),
    };
  },
});
