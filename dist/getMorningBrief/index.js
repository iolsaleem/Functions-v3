"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const functions_1 = require("@azure/functions");
const rbac_1 = require("../shared/rbac");
const cosmos_1 = require("../shared/cosmos");
functions_1.app.http('getMorningBrief', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'brief/today',
    handler: async (req, _context) => {
        const caller = await (0, rbac_1.validateRequest)(req);
        if (!caller)
            return { status: 401, body: 'Unauthorized' };
        const today = new Date().toISOString().split('T')[0];
        const briefs = await (0, cosmos_1.query)(cosmos_1.CONTAINERS.BRIEFS, `SELECT TOP 10 c.text, c.date, c.generatedAt FROM c WHERE c.date = '${today}'`).then(results => results.sort((a, b) => (b.generatedAt ?? '').localeCompare(a.generatedAt ?? '')));
        if (briefs.length === 0) {
            return { status: 404, body: JSON.stringify({ message: 'not_ready' }) };
        }
        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(briefs[0]),
        };
    },
});
//# sourceMappingURL=index.js.map