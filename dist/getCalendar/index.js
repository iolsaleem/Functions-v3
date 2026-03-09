"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const functions_1 = require("@azure/functions");
const rbac_1 = require("../shared/rbac");
const graph_1 = require("../shared/graph");
functions_1.app.http('getCalendar', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'calendar',
    handler: async (req, context) => {
        const caller = await (0, rbac_1.validateRequest)(req);
        if (!caller)
            return { status: 401, body: 'Unauthorized' };
        const ceoEmail = process.env.CEO_EMAIL || 'ceo@iol.world';
        const now = new Date();
        const sevenDays = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        try {
            const events = await (0, graph_1.fetchCalendarEvents)(ceoEmail, now.toISOString(), sevenDays.toISOString());
            return {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ events }),
            };
        }
        catch (err) {
            context.error('[getCalendar] Error:', err);
            return { status: 500, body: JSON.stringify({ error: 'Calendar fetch failed' }) };
        }
    },
});
//# sourceMappingURL=index.js.map