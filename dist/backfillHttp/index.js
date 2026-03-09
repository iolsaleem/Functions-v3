"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const functions_1 = require("@azure/functions");
const cosmos_1 = require("../shared/cosmos");
const rbac_1 = require("../shared/rbac");
// ── POST /api/backfill/reset ───────────────────────────────────────────────
// CEO-only endpoint to reset backfill state so the nightly timer re-runs.
// Also accepts ?force=true to reset even if already complete.
//
// POST /api/backfill/status  — returns current backfill progress
// POST /api/backfill/reset   — resets all passes to restart backfill
functions_1.app.http('backfillHttp', {
    methods: ['POST', 'GET'],
    authLevel: 'anonymous',
    route: 'backfill/{action?}',
    handler: async (req, context) => {
        const caller = await (0, rbac_1.validateRequest)(req);
        if (!caller)
            return { status: 401, body: 'Unauthorized' };
        if (caller.user.level < 9)
            return { status: 403, body: 'CEO-level access required' };
        const action = req.params.action ?? 'status';
        // ── STATUS ─────────────────────────────────────────────────────────────
        if (action === 'status' || req.method === 'GET') {
            const state = await (0, cosmos_1.getById)(cosmos_1.CONTAINERS.BACKFILL_STATE, 'backfill-main');
            if (!state) {
                return {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ status: 'not_started', message: 'Backfill has never run. Trigger by waiting for 3 AM UTC or POST /api/backfill/reset.' }),
                };
            }
            const allComplete = !!(state.pass1Complete && state.pass2Complete && state.pass3Complete);
            return {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    status: allComplete ? 'complete' : 'in_progress',
                    pass1: { complete: state.pass1Complete ?? false, count: state.pass1Count ?? 0 },
                    pass2: { complete: state.pass2Complete ?? false, count: state.pass2Count ?? 0 },
                    pass3: { complete: state.pass3Complete ?? false, count: state.pass3Count ?? 0 },
                    lastUpdated: state.lastUpdated,
                }),
            };
        }
        // ── RESET ──────────────────────────────────────────────────────────────
        if (action === 'reset') {
            context.log('[backfillHttp] Resetting backfill state — all passes will re-run');
            await (0, cosmos_1.upsert)(cosmos_1.CONTAINERS.BACKFILL_STATE, {
                id: 'backfill-main',
                pass1Complete: false, pass1NextLink: undefined, pass1Count: 0,
                pass2Complete: false, pass2NextLink: undefined, pass2Count: 0,
                pass3Complete: false, pass3Count: 0,
                lastUpdated: new Date().toISOString(),
            });
            return {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ success: true, message: 'Backfill state reset. Timer will re-run at 3 AM UTC, or re-deploy to trigger now.' }),
            };
        }
        return { status: 400, body: `Unknown action: ${action}. Use status or reset.` };
    },
});
//# sourceMappingURL=index.js.map