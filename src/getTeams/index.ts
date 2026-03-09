import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { validateRequest } from '../shared/rbac';
import { query, CONTAINERS } from '../shared/cosmos';

app.http('getTeams', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'teams',
  handler: async (req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    const caller = await validateRequest(req);
    if (!caller) return { status: 401, body: 'Unauthorized' };

    try {
      // ── ENV-CONTROLLED LIMIT ─────────────────────────────────────────────
      const defaultTop = parseInt(process.env.TEAMS_TOP || '200');
      const top = parseInt(req.query.get('top') || String(defaultTop));

      // Query Cosmos for stored Teams threads (synced by teamsSync timer)
      const threads = await query<{
        id: string;
        chatId: string;
        fromName: string;
        fromUserId: string;
        content: string;
        createdDateTime: string;
        importance: string;
        importanceScore: number;
        tier: string;
        aiSummary: string;
      }>(
        CONTAINERS.TEAMS_THREADS,
        `SELECT TOP ${top} c.id, c.chatId, c.fromName, c.fromUserId, c.content,
                c.createdDateTime, c.importance, c.importanceScore, c.tier, c.aiSummary
         FROM c
         WHERE c.id != 'teamsSync-checkpoint'
         ORDER BY c.createdDateTime DESC`
      );

      return {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          threads,
          count: threads.length,
          since: process.env.BACKFILL_START_DATE || '2025-07-01',
          syncing: false,
        }),
      };
    } catch (err) {
      context.error('[getTeams] Error:', err);
      return { status: 500, body: JSON.stringify({ error: 'Teams fetch failed' }) };
    }
  },
});