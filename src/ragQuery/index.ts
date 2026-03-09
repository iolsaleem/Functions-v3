import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import Anthropic from '@anthropic-ai/sdk';
import { query, CONTAINERS } from '../shared/cosmos';
import { generateEmbedding } from '../shared/embed';
import { validateRequest } from '../shared/rbac';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-haiku-4-5-20251001';

interface EmailDoc {
  id: string;
  subject: string;
  from: { name: string; email: string };
  receivedDateTime: string;
  bu: string;
  summary: string;
  bodyPreview: string;
  embedding?: number[];
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot   += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

app.http('ragQuery', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'rag/query',
  handler: async (req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    const caller = await validateRequest(req);
    if (!caller) return { status: 401, body: 'Unauthorized' };

    let body: { question?: string; topK?: number; since?: string };
    try {
      body = await req.json() as { question?: string; topK?: number; since?: string };
    } catch {
      return { status: 400, body: 'Invalid JSON body' };
    }

    const { question, topK = 5, since } = body;
    if (!question || question.trim().length === 0) {
      return { status: 400, body: 'Missing required field: question' };
    }

    context.log(`[ragQuery] Question: "${question}", topK=${topK}`);

    // ── STEP 1: EMBED THE QUERY ───────────────────────────────────────────
    let queryEmbedding: number[] = [];
    try {
      queryEmbedding = await generateEmbedding(question);
    } catch (err) {
      context.warn('[ragQuery] Embedding failed, falling back to keyword search:', err);
    }

    // ── STEP 2: FETCH CANDIDATE EMAILS ───────────────────────────────────
    const sinceDate = since ?? '2025-07-01T00:00:00.000Z';
    const params: Array<{ name: string; value: unknown }> = [
      { name: '@since', value: sinceDate },
    ];

    const sql = `SELECT TOP 200 c.id, c.subject, c["from"], c.receivedDateTime,
      c.bu, c.summary, c.bodyPreview, c.embedding
      FROM c
      WHERE c.receivedDateTime >= @since
      ORDER BY c.receivedDateTime DESC`;

    let candidates: EmailDoc[] = [];
    try {
      // Search both live emails and archive in parallel
      const [live, archive] = await Promise.allSettled([
        query<EmailDoc>(CONTAINERS.EMAILS, sql, params),
        query<EmailDoc>(CONTAINERS.EMAIL_ARCHIVE, sql, params),
      ]);

      const liveItems    = live.status    === 'fulfilled' ? live.value    : [];
      const archiveItems = archive.status === 'fulfilled' ? archive.value : [];

      // Deduplicate by id
      const seen = new Set<string>();
      for (const e of [...liveItems, ...archiveItems]) {
        if (!seen.has(e.id)) { seen.add(e.id); candidates.push(e); }
      }
    } catch (err) {
      context.error('[ragQuery] Cosmos query failed:', err);
      return { status: 500, body: 'Failed to query email store' };
    }

    context.log(`[ragQuery] Candidates: ${candidates.length}`);

    // ── STEP 3: RANK BY EMBEDDING SIMILARITY ─────────────────────────────
    let ranked: EmailDoc[];
    if (queryEmbedding.length > 0) {
      ranked = candidates
        .filter(e => e.embedding && e.embedding.length > 0)
        .map(e => ({ ...e, _score: cosineSimilarity(queryEmbedding, e.embedding!) }))
        .sort((a: any, b: any) => b._score - a._score)
        .slice(0, topK * 3); // take 3x then let Claude re-rank

      // If too few with embeddings, pad with recency-sorted remainder
      if (ranked.length < topK) {
        const withoutEmbed = candidates.filter(e => !e.embedding || e.embedding.length === 0);
        ranked = [...ranked, ...withoutEmbed].slice(0, topK * 3);
      }
    } else {
      // Fallback: keyword match on subject + summary
      const q = question.toLowerCase();
      ranked = candidates
        .filter(e =>
          (e.subject ?? '').toLowerCase().includes(q) ||
          (e.summary ?? '').toLowerCase().includes(q) ||
          (e.bodyPreview ?? '').toLowerCase().includes(q)
        )
        .slice(0, topK * 3);

      if (ranked.length === 0) ranked = candidates.slice(0, topK * 3);
    }

    // ── STEP 4: CLAUDE SYNTHESIS ──────────────────────────────────────────
    const context_snippets = ranked.slice(0, topK).map((e, i) =>
      `[${i + 1}] From: ${e.from?.name ?? 'Unknown'} | Date: ${e.receivedDateTime?.slice(0, 10)} | Subject: ${e.subject}\nSummary: ${e.summary ?? e.bodyPreview ?? '(no summary)'}`
    ).join('\n\n');

    let answer = '';
    try {
      const msg = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 600,
        messages: [{
          role: 'user',
          content: `You are an AI assistant helping a CEO search their emails.

Question: "${question}"

Relevant emails:
${context_snippets}

Answer the question concisely based on the emails above. If the answer isn't in the emails, say so clearly. Be specific and reference email subjects/senders when relevant.`,
        }],
      });
      answer = (msg.content[0] as { text: string }).text.trim();
    } catch (err) {
      context.warn('[ragQuery] Claude synthesis failed:', err);
      answer = `Found ${ranked.length} relevant emails. Claude synthesis unavailable.`;
    }

    return {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        answer,
        sources: ranked.slice(0, topK).map(e => ({
          id:               e.id,
          subject:          e.subject,
          from:             e.from,
          receivedDateTime: e.receivedDateTime,
          bu:               e.bu,
          summary:          e.summary ?? e.bodyPreview,
        })),
        count: ranked.length,
      }),
    };
  },
});