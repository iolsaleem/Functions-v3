"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const functions_1 = require("@azure/functions");
const rbac_1 = require("../shared/rbac");
const cosmos_1 = require("../shared/cosmos");
functions_1.app.http('getTeams', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'teams',
    handler: async (req, context) => {
        const caller = await (0, rbac_1.validateRequest)(req);
        if (!caller)
            return { status: 401, body: 'Unauthorized' };
        try {
            // ── ENV-CONTROLLED LIMIT ─────────────────────────────────────────────
            const defaultTop = parseInt(process.env.TEAMS_TOP || '200');
            const top = parseInt(req.query.get('top') || String(defaultTop));
            // Query Cosmos for stored Teams threads (synced by teamsSync timer)
            const threads = await (0, cosmos_1.query)(cosmos_1.CONTAINERS.TEAMS_THREADS, `SELECT TOP ${top} c.id, c.chatId, c.fromName, c.fromUserId, c.content,
                c.createdDateTime, c.importance, c.importanceScore, c.tier, c.aiSummary
         FROM c
         WHERE c.id != 'teamsSync-checkpoint'
         ORDER BY c.createdDateTime DESC`);
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
        }
        catch (err) {
            context.error('[getTeams] Error:', err);
            return { status: 500, body: JSON.stringify({ error: 'Teams fetch failed' }) };
        }
    },
});
//# sourceMappingURL=index.js.map