"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const functions_1 = require("@azure/functions");
const cosmos_1 = require("../shared/cosmos");
/**
 * BUG-007 FIX — snoozeWakeup timer
 *
 * Previously, snooze expiry was handled inside the getEmails HTTP handler
 * with an unawaited Promise.all — a fire-and-forget that returned before
 * Cosmos writes completed, so snoozed emails never actually woke up.
 *
 * This dedicated timer runs every 5 minutes server-side and fully awaits
 * all re-surface writes. Snooze wake-up now happens regardless of whether
 * the client is actively polling.
 */
functions_1.app.timer('snoozeWakeup', {
    schedule: '0 */5 * * * *', // every 5 minutes, same cadence as emailSync
    handler: async (_timer, context) => {
        const now = new Date().toISOString();
        // ── PARAMETERIZED QUERY (consistent with getEmails fix) ───────────────
        const expired = await (0, cosmos_1.query)(cosmos_1.CONTAINERS.EMAILS, `SELECT c.id FROM c WHERE c.status = 'snoozed' AND c.snoozedUntil <= @now`, [{ name: '@now', value: now }]);
        if (expired.length === 0) {
            context.log('[snoozeWakeup] No snoozed emails to re-surface.');
            return;
        }
        context.log(`[snoozeWakeup] Re-surfacing ${expired.length} snoozed email(s)...`);
        let woken = 0;
        let errors = 0;
        // Process sequentially to avoid throttling Cosmos on large batches
        for (const e of expired) {
            try {
                const existing = await (0, cosmos_1.getById)(cosmos_1.CONTAINERS.EMAILS, e.id);
                if (existing) {
                    await (0, cosmos_1.upsert)(cosmos_1.CONTAINERS.EMAILS, {
                        ...existing,
                        status: 'active',
                        snoozedUntil: null,
                    });
                    woken++;
                }
            }
            catch (err) {
                context.error(`[snoozeWakeup] Failed to re-surface email ${e.id}:`, err);
                errors++;
            }
        }
        context.log(`[snoozeWakeup] Done. Woken: ${woken}, Errors: ${errors}`);
    },
});
//# sourceMappingURL=index.js.map