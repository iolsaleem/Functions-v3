import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { validateRequest } from '../shared/rbac';
import { getById, query, CONTAINERS } from '../shared/cosmos';
import { graphClient } from '../shared/graph';

app.http('health', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'health',
  handler: async (req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    const caller = await validateRequest(req);
    if (!caller) return { status: 401, body: 'Unauthorized' };

    const services: Record<string, string> = {};
    const details: Record<string, unknown> = {};

    // ── 1. COSMOS — single lightweight query ──────────────────────────────
    try {
      const [emails, teams, briefs] = await Promise.all([
        query<number>(CONTAINERS.EMAILS,        'SELECT VALUE COUNT(1) FROM c', []),
        query<number>(CONTAINERS.TEAMS_THREADS, 'SELECT VALUE COUNT(1) FROM c WHERE c.id != "teamsSync-checkpoint"', []),
        query<number>(CONTAINERS.BRIEFS,        'SELECT VALUE COUNT(1) FROM c', []),
      ]);
      services.cosmos = 'ok';
      details.cosmos = {
        emails: (emails as unknown as number[])[0] ?? 0,
        teams:  (teams  as unknown as number[])[0] ?? 0,
        briefs: (briefs as unknown as number[])[0] ?? 0,
      };
    } catch (e) {
      services.cosmos = 'error';
      details.cosmosError = String(e);
    }

    // ── 2. GRAPH — token check only (no mailbox probe) ────────────────────
    try {
      const client = await graphClient();
      const ceoEmail = process.env.CEO_EMAIL || 'ceo@iol.world';
      await client.api(`/users/${ceoEmail}`).select('displayName').get();
      services.graph = 'ok';
    } catch (e) {
      services.graph = 'error';
      details.graphError = String(e);
    }

    // ── 3. ANTHROPIC — no live ping, just key presence check ─────────────
    const classifyEnabled = (process.env.ANTHROPIC_CLASSIFY_ENABLED ?? 'true').toLowerCase() === 'true';
    if (!classifyEnabled) {
      services.anthropic = 'disabled';
    } else if (!process.env.ANTHROPIC_API_KEY) {
      services.anthropic = 'error';
      details.anthropicError = 'ANTHROPIC_API_KEY not set';
    } else {
      services.anthropic = 'ok';
    }

    // ── 4. TEAMS SYNC CHECKPOINT ──────────────────────────────────────────
    try {
      const cp = await getById<{
        totalProcessed: number;
        backfillComplete: boolean;
        lastUpdated: string;
      }>(CONTAINERS.TEAMS_THREADS, 'teamsSync-checkpoint');
      details.teamsSync = {
        totalProcessed:   cp?.totalProcessed   ?? 0,
        backfillComplete: cp?.backfillComplete ?? false,
        lastUpdated:      cp?.lastUpdated      ?? 'never',
      };
    } catch {
      details.teamsSync = { totalProcessed: 0, backfillComplete: false, lastUpdated: 'never' };
    }

    // ── 5. CONFIG (env-controlled limits) ────────────────────────────────
    details.config = {
      teamsTop:       parseInt(process.env.TEAMS_TOP   || '200'),
      emailsTop:      parseInt(process.env.EMAILS_TOP  || '500'),
      classifyEnabled,
      classifyModel:  process.env.ANTHROPIC_MODEL_CLASSIFY ?? 'claude-haiku-4-5-20251001',
      backfillStart:  process.env.BACKFILL_START_DATE ?? '2025-07-01',
      ceoEmail:       process.env.CEO_EMAIL ?? '(not set)',
    };

    // ── OVERALL ───────────────────────────────────────────────────────────
    const degraded = Object.values(services).some(s => s === 'error');
    const overall  = degraded ? 'degraded' : 'ok';

    context.log(`[health] ${overall} — cosmos:${services.cosmos} graph:${services.graph} anthropic:${services.anthropic}`);

    return {
      status: degraded ? 207 : 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
      body: JSON.stringify({ overall, services, details }),
    };
  },
});