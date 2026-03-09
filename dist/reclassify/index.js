"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const functions_1 = require("@azure/functions");
const classifier_1 = require("../shared/classifier");
const cosmos_1 = require("../shared/cosmos");
const embed_1 = require("../shared/embed");
const graph_1 = require("../shared/graph");
const rbac_1 = require("../shared/rbac");
// ── POST /api/reclassify ──────────────────────────────────
// Re-classifies existing emails with the latest classifier
// (lane detection, new scoring signals) while preserving all
// action states (done/archived/delegated/snoozed/delegatedTo).
//
// Body options:
//   { "container": "emails" }           — re-classify live inbox (default)
//   { "container": "email-archive" }    — re-classify backfill archive
//   { "force": true }                   — re-classify even if lane=active (re-scores everything)
//   { "limit": 200 }                    — cap at N emails (default 500)
functions_1.app.http('reclassify', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'reclassify',
    handler: async (req, context) => {
        // ── AUTH — CEO-only operation ──────────────────────────
        const caller = await (0, rbac_1.validateRequest)(req);
        if (!caller)
            return { status: 401, body: 'Unauthorized' };
        if (caller.user.level < 9)
            return { status: 403, body: 'CEO-level access required' };
        let body = {};
        try {
            body = await req.json();
        }
        catch { /* defaults */ }
        const containerName = body.container === 'email-archive'
            ? cosmos_1.CONTAINERS.EMAIL_ARCHIVE
            : cosmos_1.CONTAINERS.EMAILS;
        const limit = Math.min(body.limit ?? 500, 2000);
        const force = body.force ?? false;
        context.log(`[reclassify] Starting — container=${containerName}, limit=${limit}, force=${force}`);
        // ── LOAD EMAILS FOR RECLASSIFICATION ──────────────────
        // Skip emails already in an automated/low-signal lane unless force=true
        const filterClause = force
            ? ''
            : `AND (NOT IS_DEFINED(c.lane) OR c.lane = 'active')`;
        const emails = await (0, cosmos_1.query)(containerName, `SELECT TOP ${limit} c.id, c.subject, c[\"from\"], c.receivedDateTime,
              c.isRead, c.hasAttachments, c.bodyPreview, c.conversationId,
              c.status, c.snoozedUntil, c.delegatedTo, c.delegatedAt,
              c.archivedAt, c.doneAt, c.bu, c.tier, c.aiScore
       FROM c WHERE IS_DEFINED(c.id) ${filterClause}
       ORDER BY c.receivedDateTime DESC`);
        context.log(`[reclassify] Loaded ${emails.length} emails to reclassify`);
        let updated = 0;
        let errors = 0;
        let skipped = 0;
        const ceoEmail = process.env.CEO_EMAIL || 'ceo@iol.world';
        for (const stored of emails) {
            try {
                // Build a minimal GraphEmail shape so classifyEmail can work with it.
                // We fetch from Graph only if bodyPreview is sparse — most stored emails have enough.
                let graphEmail;
                try {
                    graphEmail = await (0, graph_1.fetchEmailById)(ceoEmail, stored.id);
                }
                catch {
                    // Graph fetch failed (email may have been deleted). Build from stored data.
                    graphEmail = {
                        id: stored.id,
                        subject: stored.subject ?? '',
                        from: { emailAddress: { name: stored.from?.name ?? '', address: stored.from?.email ?? '' } },
                        toRecipients: [],
                        ccRecipients: [],
                        receivedDateTime: stored.receivedDateTime,
                        isRead: stored.isRead ?? false,
                        importance: 'normal',
                        hasAttachments: stored.hasAttachments ?? false,
                        bodyPreview: stored.bodyPreview ?? '',
                        body: { contentType: 'text', content: stored.bodyPreview ?? '' },
                        conversationId: stored.conversationId ?? '',
                    };
                }
                const result = await (0, classifier_1.classifyEmail)(graphEmail);
                // Build embed text for vector search
                const embedText = (0, embed_1.buildEmailEmbedText)({
                    subject: stored.subject,
                    from: stored.from,
                    bu: result.bu,
                    tags: result.tags,
                    summary: result.summary,
                    bodyPreview: stored.bodyPreview,
                });
                const embedding = await (0, embed_1.generateEmbedding)(embedText);
                // Read the full existing document so we don't lose any fields
                const { query: _q, ...cosmosMod } = await Promise.resolve().then(() => __importStar(require('../shared/cosmos')));
                const { getById } = cosmosMod;
                const existing = await getById(containerName, stored.id);
                if (!existing) {
                    skipped++;
                    continue;
                }
                // Merge: preserve all action state, replace classification fields
                const updated_doc = {
                    ...existing,
                    bu: result.bu,
                    tier: result.tier,
                    aiScore: result.aiScore,
                    tags: result.tags,
                    lane: result.lane,
                    isVip: result.isVip,
                    isPinned: result.isPinned,
                    isInternal: result.isInternal,
                    summary: result.summary,
                    actionRequired: result.actionRequired,
                    suggestedDelegatee: result.suggestedDelegatee,
                    sentiment: result.sentiment,
                    reclassifiedAt: new Date().toISOString(),
                    ...(embedding.length > 0 ? { embedding } : {}),
                };
                await (0, cosmos_1.upsert)(containerName, updated_doc);
                updated++;
                // Rate limit: 200ms between emails
                await sleep(200);
            }
            catch (err) {
                context.error(`[reclassify] Failed email ${stored.id}:`, err);
                errors++;
            }
        }
        const summary = {
            total: emails.length,
            updated,
            skipped,
            errors,
            container: containerName,
            force,
        };
        context.log('[reclassify] Done:', summary);
        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(summary),
        };
    },
});
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
//# sourceMappingURL=index.js.map