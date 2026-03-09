"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const functions_1 = require("@azure/functions");
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
const graph_1 = require("../shared/graph");
const cosmos_1 = require("../shared/cosmos");
const embed_1 = require("../shared/embed");
const anthropic = new sdk_1.default({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL_CLASSIFY = process.env.ANTHROPIC_MODEL_CLASSIFY ?? 'claude-haiku-4-5-20251001';
// ── ENV-CONTROLLED SETTINGS ──────────────────────────────────────────────────
// ANTHROPIC_CLASSIFY_ENABLED=true|false  — toggle AI classification on/off
// TEAMS_TOP=200                          — max messages loaded by getTeams
// CHATS_PER_RUN is fixed at 15 (safe timeout limit)
const CHATS_PER_RUN = 15;
const CLASSIFY_ENABLED = (process.env.ANTHROPIC_CLASSIFY_ENABLED ?? 'true').toLowerCase() === 'true';
functions_1.app.timer('teamsSync', {
    schedule: '0 */5 * * * *',
    runOnStartup: true,
    handler: async (_timer, context) => {
        context.log(`[teamsSync] Starting Teams thread sync... (classify=${CLASSIFY_ENABLED})`);
        const ceoEmail = process.env.CEO_EMAIL || 'ceo@iol.world';
        let processed = 0;
        let errors = 0;
        try {
            const client = await (0, graph_1.graphClient)();
            // ── LOAD CHECKPOINT ──────────────────────────────────────────────────
            let checkpoint = null;
            try {
                checkpoint = await (0, cosmos_1.getById)(cosmos_1.CONTAINERS.TEAMS_THREADS, 'teamsSync-checkpoint');
            }
            catch {
                checkpoint = null;
            }
            // ── FETCH ONE PAGE OF CHATS ──────────────────────────────────────────
            let res;
            if (checkpoint?.nextLink) {
                context.log(`[teamsSync] Resuming from checkpoint. Total processed so far: ${checkpoint.totalProcessed}`);
                res = await client.api(checkpoint.nextLink).get();
            }
            else if (checkpoint?.backfillComplete) {
                context.log('[teamsSync] Backfill complete. Fetching latest chats...');
                res = await client
                    .api(`/users/${ceoEmail}/chats`)
                    .top(CHATS_PER_RUN)
                    .orderby('lastUpdatedDateTime desc')
                    .get();
            }
            else {
                context.log('[teamsSync] First run — starting full backfill...');
                res = await client
                    .api(`/users/${ceoEmail}/chats`)
                    .top(CHATS_PER_RUN)
                    .get();
            }
            const chats = res.value ?? [];
            context.log(`[teamsSync] Processing ${chats.length} chats this run...`);
            // ── PROCESS EACH CHAT ────────────────────────────────────────────────
            for (const chat of chats) {
                try {
                    const msgsRes = await client
                        .api(`/chats/${chat.id}/messages`)
                        .top(10)
                        .get();
                    const messages = msgsRes.value ?? [];
                    for (const msg of messages) {
                        try {
                            if (msg.messageType !== 'message')
                                continue;
                            if (!msg.body?.content || msg.body.content === '<systemEventMessage/>')
                                continue;
                            if (msg.deletedDateTime)
                                continue;
                            const threadId = `${chat.id}_${msg.id}`;
                            let existing = null;
                            try {
                                existing = await (0, cosmos_1.getById)(cosmos_1.CONTAINERS.TEAMS_THREADS, threadId);
                            }
                            catch {
                                existing = null;
                            }
                            const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
                            if (existing && existing.syncedAt > cutoff24h)
                                continue;
                            const content = msg.body.content.replace(/<[^>]+>/g, '').trim().slice(0, 1000);
                            if (!content)
                                continue;
                            const fromName = msg.from?.user?.displayName || msg.from?.application?.displayName || 'Unknown';
                            const fromUserId = msg.from?.user?.id || '';
                            // ── AI CLASSIFICATION (respects ANTHROPIC_CLASSIFY_ENABLED) ──
                            let importanceScore = 30;
                            let aiSummary = content.slice(0, 100);
                            if (CLASSIFY_ENABLED) {
                                const result = await classifyTeamsThread(content, fromName);
                                importanceScore = result.importanceScore;
                                aiSummary = result.aiSummary;
                            }
                            const tier = importanceScore >= 70 ? 'T1' : importanceScore >= 40 ? 'T2' : 'T3';
                            const doc = {
                                id: threadId,
                                chatId: chat.id,
                                fromName,
                                fromUserId,
                                content,
                                subject: chat.topic || undefined,
                                createdDateTime: msg.createdDateTime,
                                importance: importanceScore >= 70 ? 'high' : importanceScore >= 40 ? 'normal' : 'low',
                                importanceScore,
                                tier,
                                aiSummary,
                                syncedAt: new Date().toISOString(),
                            };
                            // ── EMBEDDINGS (only when classify is enabled) ────────────────
                            if (CLASSIFY_ENABLED) {
                                const embedText = (0, embed_1.buildTeamsEmbedText)({
                                    fromName: doc.fromName,
                                    content: doc.content,
                                    subject: doc.subject,
                                    importanceScore: doc.importanceScore,
                                });
                                const embedding = await (0, embed_1.generateEmbedding)(embedText);
                                if (embedding.length > 0)
                                    doc.embedding = embedding;
                            }
                            await (0, cosmos_1.upsert)(cosmos_1.CONTAINERS.TEAMS_THREADS, doc);
                            processed++;
                            await sleep(50);
                        }
                        catch (msgErr) {
                            context.error(`[teamsSync] Failed message in chat ${chat.id}:`, msgErr);
                            errors++;
                        }
                    }
                }
                catch (chatErr) {
                    context.error(`[teamsSync] Failed chat ${chat.id}:`, chatErr);
                    errors++;
                }
            }
            // ── SAVE CHECKPOINT ──────────────────────────────────────────────────
            const totalSoFar = (checkpoint?.totalProcessed ?? 0) + chats.length;
            const hasMore = !!res['@odata.nextLink'];
            const newCheckpoint = {
                id: 'teamsSync-checkpoint',
                nextLink: hasMore ? res['@odata.nextLink'] : undefined,
                totalProcessed: totalSoFar,
                backfillComplete: !hasMore,
                lastUpdated: new Date().toISOString(),
            };
            await (0, cosmos_1.upsert)(cosmos_1.CONTAINERS.TEAMS_THREADS, newCheckpoint);
            if (hasMore) {
                context.log(`[teamsSync] More chats remain. Will continue next run. Total so far: ${totalSoFar}`);
            }
            else {
                context.log(`[teamsSync] All chats processed. Backfill complete. Total: ${totalSoFar}`);
            }
        }
        catch (err) {
            context.error('[teamsSync] Fatal error:', err);
        }
        context.log(`[teamsSync] Done. Processed: ${processed}, Errors: ${errors}`);
    },
});
async function classifyTeamsThread(content, fromName) {
    try {
        const msg = await anthropic.messages.create({
            model: MODEL_CLASSIFY,
            max_tokens: 200,
            messages: [{
                    role: 'user',
                    content: `Rate this Teams message for CEO importance (0-100) and give a 1-sentence summary.\nFrom: ${fromName}\nMessage: ${content.slice(0, 500)}\n\nReturn ONLY JSON: {"importanceScore": <0-100>, "aiSummary": "<1 sentence>"}`,
                }],
        });
        const parsed = JSON.parse(msg.content[0].text.trim());
        return parsed;
    }
    catch {
        return { importanceScore: 30, aiSummary: content.slice(0, 100) };
    }
}
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
//# sourceMappingURL=index.js.map