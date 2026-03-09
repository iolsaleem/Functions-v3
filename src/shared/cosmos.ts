import { CosmosClient, Container, Database } from '@azure/cosmos';

let _client: CosmosClient | null = null;
let _db: Database | null = null;

function getClient(): CosmosClient {
  if (!_client) {
    const endpoint = process.env.COSMOS_ENDPOINT;
    const key      = process.env.COSMOS_KEY;
    if (!endpoint || !key) throw new Error('COSMOS_ENDPOINT and COSMOS_KEY must be set');
    _client = new CosmosClient({
      endpoint,
      key,
      connectionPolicy: {
        retryOptions: {
          maxRetryAttemptCount: 15,
          fixedRetryIntervalInMilliseconds: 0,
          maxWaitTimeInSeconds: 30,
        },
      },
    });
  }
  return _client;
}

function getDb(): Database {
  if (!_db) {
    _db = getClient().database(process.env.COSMOS_DATABASE || 'project-athena-db');
  }
  return _db;
}

export function container(name: string): Container {
  return getDb().container(name);
}

// ── CONTAINER NAMES ───────────────────────────────────────
export const CONTAINERS = {
  // Core email (vector-enabled)
  EMAILS:            'emails',
  EMAIL_ARCHIVE:     'email-archive',          // renamed from EMAILS_HISTORY
  SENT_ITEMS:        'sent-items',             // NEW

  // Communication (vector-enabled)
  TEAMS_THREADS:     'teams-threads',          // renamed from TEAMS_MESSAGES
  CALENDAR_EVENTS:   'calendar-events',
  BRIEFS:            'daily-briefs',

  // Intelligence & config
  CONTACTS_INTEL:    'contacts-intelligence',  // NEW
  CLASSIFIER_CONFIG: 'classifier-config',      // NEW

  // Operational (unchanged)
  USERS:             'users',
  CONTACTS:          'contacts',
  COMPANIES:         'companies',
  CLASSIFIER:        'classifier-corrections',
  WEBHOOKS:          'webhook-subscriptions',
  BACKFILL_STATE:    'backfill-state',
} as const;

// ── EXPLICIT RETRY WRAPPER ────────────────────────────────
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 5,
  label = 'cosmos-op'
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastErr = err;
      const statusCode = (err as { code?: number })?.code;
      if (statusCode === 429) {
        const retryMs = (err as { retryAfterInMilliseconds?: number })?.retryAfterInMilliseconds
          ?? Math.min(1000 * Math.pow(2, attempt), 30000);
        console.warn(`[${label}] 429 throttled. Attempt ${attempt}/${maxAttempts}. Retrying in ${retryMs}ms`);
        await sleep(retryMs);
      } else {
        throw err;
      }
    }
  }
  throw lastErr;
}

// ── UPSERT HELPER ─────────────────────────────────────────
export async function upsert<T extends { id: string }>(
  containerName: string,
  item: T
): Promise<T> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { resource } = await container(containerName).items.upsert(item as any);
  return resource as unknown as T;
}

// ── QUERY HELPER ──────────────────────────────────────────
export async function query<T>(
  containerName: string,
  sql: string,
  params: Array<{ name: string; value: unknown }> = []
): Promise<T[]> {
  const { resources } = await container(containerName).items
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .query<any>({ query: sql, parameters: params as any })
    .fetchAll();
  return resources as T[];
}

// ── GET BY ID ─────────────────────────────────────────────
export async function getById<T>(
  containerName: string,
  id: string,
  partitionKey?: string
): Promise<T | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { resource } = await (container(containerName).item(id, partitionKey ?? id) as any).read();
    return (resource ?? null) as T | null;
  } catch {
    return null;
  }
}

// ── VECTOR SEARCH ─────────────────────────────────────────
// Cosine similarity search via Cosmos NoSQL VectorDistance.
// Returns top-K docs ordered by similarity to the provided embedding.
// filter: optional WHERE clause fragment e.g. "c.status = 'active'"
export async function vectorSearch<T>(
  containerName: string,
  embedding: number[],
  topK = 10,
  filter?: string
): Promise<T[]> {
  const vectorStr    = JSON.stringify(embedding);
  const whereClause  = filter ? `WHERE ${filter}` : '';
  const sql = `
    SELECT TOP ${topK} c.*, VectorDistance(c.embedding, ${vectorStr}) AS _score
    FROM c ${whereClause}
    ORDER BY VectorDistance(c.embedding, ${vectorStr})`;

  const { resources } = await container(containerName).items
    .query<T>({ query: sql })
    .fetchAll();
  return resources;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
