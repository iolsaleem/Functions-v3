// ── SHARED EMBEDDING UTILITY ──────────────────────────────
// Generates 1536-dim embeddings via Azure OpenAI text-embedding-3-small.
// All functions return [] on any failure — never throws.
// In-memory cache keyed by text hash to avoid redundant API calls.

import { GraphEmail, GraphEvent, GraphTeamsMessage } from './graph';

const DEPLOYMENT   = process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT || 'text-embedding-3-small';
const ENDPOINT     = process.env.AZURE_OPENAI_ENDPOINT || '';
const API_KEY      = process.env.AZURE_OPENAI_KEY || '';
const API_VERSION  = '2024-02-01';
const DIMENSIONS   = 1536;

// ── IN-MEMORY CACHE ───────────────────────────────────────
// Prevents duplicate API calls within a single function invocation.
const _cache = new Map<string, number[]>();

function cacheKey(text: string): string {
  // Simple djb2 hash — fast, good enough for dedup within one invocation
  let h = 5381;
  for (let i = 0; i < Math.min(text.length, 500); i++) {
    h = ((h << 5) + h) ^ text.charCodeAt(i);
  }
  return String(h >>> 0);
}

// ── CORE GENERATE FUNCTION ────────────────────────────────
export async function generateEmbedding(text: string): Promise<number[]> {
  if (!ENDPOINT || !API_KEY) {
    console.warn('[embed] AZURE_OPENAI_ENDPOINT or AZURE_OPENAI_KEY not set — skipping embedding');
    return [];
  }

  const input = text.trim().slice(0, 8000); // max safe input length
  if (!input) return [];

  const key = cacheKey(input);
  if (_cache.has(key)) return _cache.get(key)!;

  const url = `${ENDPOINT}openai/deployments/${DEPLOYMENT}/embeddings?api-version=${API_VERSION}`;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'api-key': API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ input, dimensions: DIMENSIONS }),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`OpenAI embed error ${res.status}: ${errText}`);
      }

      const json = await res.json() as { data: Array<{ embedding: number[] }> };
      const embedding = json.data[0]?.embedding ?? [];
      _cache.set(key, embedding);
      return embedding;

    } catch (err) {
      lastErr = err;
      if (attempt < 3) {
        const wait = Math.pow(2, attempt) * 500; // 1s, 2s
        console.warn(`[embed] Attempt ${attempt} failed, retrying in ${wait}ms:`, err);
        await sleep(wait);
      }
    }
  }

  // Never throw — embedding failure must not block the main operation
  console.error('[embed] generateEmbedding failed after 3 attempts:', lastErr);
  return [];
}

// ── EMAIL EMBED TEXT ──────────────────────────────────────
// Constructs a rich semantic text string from an email for embedding.
export function buildEmailEmbedText(email: {
  subject?: string;
  from?: { name?: string; email?: string } | { emailAddress?: { name?: string; address?: string } };
  bodyPreview?: string;
  bu?: string;
  tags?: string[];
  summary?: string;
}): string {
  // Handle both Graph format (emailAddress.address) and stored format (email)
  const fromName  = (email.from as { name?: string })?.name
    ?? (email.from as { emailAddress?: { name?: string } })?.emailAddress?.name ?? '';
  const fromEmail = (email.from as { email?: string })?.email
    ?? (email.from as { emailAddress?: { address?: string } })?.emailAddress?.address ?? '';

  const parts = [
    email.subject    ? `Subject: ${email.subject}` : '',
    fromName         ? `From: ${fromName}` : '',
    fromEmail        ? `Email: ${fromEmail}` : '',
    email.bu         ? `Business unit: ${email.bu}` : '',
    email.tags?.length ? `Tags: ${email.tags.join(', ')}` : '',
    email.summary    ? `Summary: ${email.summary}` : '',
    email.bodyPreview ? `Preview: ${email.bodyPreview.slice(0, 400)}` : '',
  ].filter(Boolean);

  return parts.join('\n');
}

// ── TEAMS EMBED TEXT ──────────────────────────────────────
export function buildTeamsEmbedText(thread: {
  fromName?: string;
  content?: string;
  subject?: string;
  importanceScore?: number;
}): string {
  const parts = [
    thread.subject    ? `Topic: ${thread.subject}` : '',
    thread.fromName   ? `From: ${thread.fromName}` : '',
    thread.content    ? `Message: ${thread.content.slice(0, 600)}` : '',
    thread.importanceScore != null ? `Importance: ${thread.importanceScore}` : '',
  ].filter(Boolean);
  return parts.join('\n');
}

// ── CALENDAR EMBED TEXT ───────────────────────────────────
export function buildCalendarEmbedText(event: {
  subject?: string;
  location?: string;
  attendees?: string[];
  bodyPreview?: string;
  start?: string;
}): string {
  const parts = [
    event.subject    ? `Meeting: ${event.subject}` : '',
    event.start      ? `When: ${event.start}` : '',
    event.location   ? `Location: ${event.location}` : '',
    event.attendees?.length ? `Attendees: ${event.attendees.join(', ')}` : '',
    event.bodyPreview ? `Details: ${event.bodyPreview.slice(0, 400)}` : '',
  ].filter(Boolean);
  return parts.join('\n');
}

// ── GRAPH TYPE OVERLOADS ──────────────────────────────────
// Convenience wrappers accepting raw Graph API types

export function buildEmailEmbedTextFromGraph(email: GraphEmail): string {
  return buildEmailEmbedText({
    subject: email.subject,
    from: email.from,
    bodyPreview: email.bodyPreview,
  });
}

export function buildCalendarEmbedTextFromGraph(event: GraphEvent): string {
  return buildCalendarEmbedText({
    subject: event.subject,
    start: event.start?.dateTime,
    location: event.location?.displayName,
    attendees: event.attendees?.map(a => a.emailAddress?.name ?? a.emailAddress?.address ?? ''),
    bodyPreview: event.bodyPreview,
  });
}

export function buildTeamsEmbedTextFromGraph(msg: GraphTeamsMessage): string {
  return buildTeamsEmbedText({
    fromName: msg.from?.user?.displayName,
    content: msg.body?.content?.replace(/<[^>]+>/g, ''),
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
