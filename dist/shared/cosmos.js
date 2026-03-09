"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CONTAINERS = void 0;
exports.container = container;
exports.withRetry = withRetry;
exports.upsert = upsert;
exports.query = query;
exports.getById = getById;
exports.vectorSearch = vectorSearch;
const cosmos_1 = require("@azure/cosmos");
let _client = null;
let _db = null;
function getClient() {
    if (!_client) {
        const endpoint = process.env.COSMOS_ENDPOINT;
        const key = process.env.COSMOS_KEY;
        if (!endpoint || !key)
            throw new Error('COSMOS_ENDPOINT and COSMOS_KEY must be set');
        _client = new cosmos_1.CosmosClient({
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
function getDb() {
    if (!_db) {
        _db = getClient().database(process.env.COSMOS_DATABASE || 'project-athena-db');
    }
    return _db;
}
function container(name) {
    return getDb().container(name);
}
// ── CONTAINER NAMES ───────────────────────────────────────
exports.CONTAINERS = {
    // Core email (vector-enabled)
    EMAILS: 'emails',
    EMAIL_ARCHIVE: 'email-archive', // renamed from EMAILS_HISTORY
    SENT_ITEMS: 'sent-items', // NEW
    // Communication (vector-enabled)
    TEAMS_THREADS: 'teams-threads', // renamed from TEAMS_MESSAGES
    CALENDAR_EVENTS: 'calendar-events',
    BRIEFS: 'daily-briefs',
    // Intelligence & config
    CONTACTS_INTEL: 'contacts-intelligence', // NEW
    CLASSIFIER_CONFIG: 'classifier-config', // NEW
    // Operational (unchanged)
    USERS: 'users',
    CONTACTS: 'contacts',
    COMPANIES: 'companies',
    CLASSIFIER: 'classifier-corrections',
    WEBHOOKS: 'webhook-subscriptions',
    BACKFILL_STATE: 'backfill-state',
};
// ── EXPLICIT RETRY WRAPPER ────────────────────────────────
async function withRetry(fn, maxAttempts = 5, label = 'cosmos-op') {
    let lastErr;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await fn();
        }
        catch (err) {
            lastErr = err;
            const statusCode = err?.code;
            if (statusCode === 429) {
                const retryMs = err?.retryAfterInMilliseconds
                    ?? Math.min(1000 * Math.pow(2, attempt), 30000);
                console.warn(`[${label}] 429 throttled. Attempt ${attempt}/${maxAttempts}. Retrying in ${retryMs}ms`);
                await sleep(retryMs);
            }
            else {
                throw err;
            }
        }
    }
    throw lastErr;
}
// ── UPSERT HELPER ─────────────────────────────────────────
async function upsert(containerName, item) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { resource } = await container(containerName).items.upsert(item);
    return resource;
}
// ── QUERY HELPER ──────────────────────────────────────────
async function query(containerName, sql, params = []) {
    const { resources } = await container(containerName).items
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .query({ query: sql, parameters: params })
        .fetchAll();
    return resources;
}
// ── GET BY ID ─────────────────────────────────────────────
async function getById(containerName, id, partitionKey) {
    try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { resource } = await container(containerName).item(id, partitionKey ?? id).read();
        return (resource ?? null);
    }
    catch {
        return null;
    }
}
// ── VECTOR SEARCH ─────────────────────────────────────────
// Cosine similarity search via Cosmos NoSQL VectorDistance.
// Returns top-K docs ordered by similarity to the provided embedding.
// filter: optional WHERE clause fragment e.g. "c.status = 'active'"
async function vectorSearch(containerName, embedding, topK = 10, filter) {
    const vectorStr = JSON.stringify(embedding);
    const whereClause = filter ? `WHERE ${filter}` : '';
    const sql = `
    SELECT TOP ${topK} c.*, VectorDistance(c.embedding, ${vectorStr}) AS _score
    FROM c ${whereClause}
    ORDER BY VectorDistance(c.embedding, ${vectorStr})`;
    const { resources } = await container(containerName).items
        .query({ query: sql })
        .fetchAll();
    return resources;
}
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
//# sourceMappingURL=cosmos.js.map