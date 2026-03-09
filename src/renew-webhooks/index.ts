import { app, Timer, InvocationContext } from '@azure/functions';

// ── WEBHOOK RENEWAL FUNCTION ──────────────────────────────
// Runs daily at 02:30 UTC (06:30 GST).
// Renews Graph subscriptions before they expire. Without this, the
// webhook dies silently and the system falls back to 5-minute polling.
//
// Graph mail subscription max expiry = 4,230 minutes (~3 days).
// This runs daily, so subscriptions are always renewed 2–3 days before expiry.
//
// IMPORTANT: Must use GRAPH_TENANT_ID (O365 tenant where ceo@iol.world lives),
// NOT AZURE_TENANT_ID (Azure resources tenant). Using the wrong tenant causes
// silent auth failures and subscriptions expire unrenewed.

const GRAPH_MAIL_MAX_EXPIRY_MINUTES = 4230;

app.timer('renewWebhooks', {
  schedule: '0 30 2 * * *',   // 02:30 UTC = 06:30 GST daily
  runOnStartup: false,
  handler: async (_timer: Timer, context: InvocationContext) => {
    context.log('[renewWebhooks] Starting subscription renewal check');

    // ── USE GRAPH TENANT, NOT AZURE TENANT ────────────────────────────────
    // GRAPH_TENANT_ID = O365 tenant (f2f63ea7...) — required for Graph API
    // AZURE_TENANT_ID = Azure resources tenant — only for SWA/Cosmos auth
    const tenantId     = process.env.GRAPH_TENANT_ID;
    const clientId     = process.env.GRAPH_CLIENT_ID;
    const clientSecret = process.env.GRAPH_CLIENT_SECRET;

    if (!tenantId || !clientId || !clientSecret) {
      context.error('[renewWebhooks] Missing GRAPH_TENANT_ID / GRAPH_CLIENT_ID / GRAPH_CLIENT_SECRET — cannot renew');
      return;
    }

    try {
      const token = await getGraphToken(tenantId, clientId, clientSecret);

      // List all active subscriptions
      const subsRes = await fetch('https://graph.microsoft.com/v1.0/subscriptions', {
        headers: { 'Authorization': `Bearer ${token}` },
      });

      if (!subsRes.ok) {
        context.error(`[renewWebhooks] Failed to list subscriptions: ${subsRes.status}`);
        return;
      }

      const subs = await subsRes.json() as { value: GraphSubscription[] };
      context.log(`[renewWebhooks] Found ${subs.value?.length ?? 0} subscriptions`);

      const newExpiry = new Date(Date.now() + GRAPH_MAIL_MAX_EXPIRY_MINUTES * 60 * 1000).toISOString();
      let renewed = 0;
      let errors  = 0;

      for (const sub of subs.value ?? []) {
        const expiresAt = new Date(sub.expirationDateTime);
        const hoursUntilExpiry = (expiresAt.getTime() - Date.now()) / (1000 * 60 * 60);

        // Renew if expiring within 48 hours (well ahead of the 3-day window)
        if (hoursUntilExpiry > 48) {
          context.log(`[renewWebhooks] Subscription ${sub.id} OK — expires in ${Math.round(hoursUntilExpiry)}h`);
          continue;
        }

        context.log(`[renewWebhooks] Renewing ${sub.id} (expires in ${Math.round(hoursUntilExpiry)}h)`);

        const renewRes = await fetch(`https://graph.microsoft.com/v1.0/subscriptions/${sub.id}`, {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ expirationDateTime: newExpiry }),
        });

        if (renewRes.ok) {
          renewed++;
          context.log(`[renewWebhooks] ✅ Renewed ${sub.id} → expires ${newExpiry}`);
        } else {
          errors++;
          const err = await renewRes.text();
          context.error(`[renewWebhooks] ❌ Failed to renew ${sub.id}: ${renewRes.status} — ${err}`);

          // If renewal fails, attempt to re-register the subscription
          const notifUrl = process.env.GRAPH_NOTIFICATION_URL;
          const secret   = process.env.GRAPH_WEBHOOK_SECRET;
          const ceoEmail = process.env.CEO_EMAIL || 'ceo@iol.world';

          if (notifUrl && secret) {
            context.log(`[renewWebhooks] Attempting re-registration for failed subscription...`);
            const reregRes = await fetch('https://graph.microsoft.com/v1.0/subscriptions', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                changeType:         'created,updated',
                notificationUrl:    notifUrl,
                resource:           `/users/${ceoEmail}/mailFolders/inbox/messages`,
                expirationDateTime: newExpiry,
                clientState:        secret,
              }),
            });
            if (reregRes.ok) {
              const newSub = await reregRes.json() as { id: string };
              renewed++;
              errors--;
              context.log(`[renewWebhooks] ✅ Re-registered subscription: ${newSub.id}`);
            } else {
              context.error(`[renewWebhooks] ❌ Re-registration also failed: ${reregRes.status}`);
            }
          }
        }
      }

      context.log(`[renewWebhooks] Complete. Renewed: ${renewed}, Errors: ${errors}`);

      if (errors > 0) {
        context.error(`[renewWebhooks] ALERT: ${errors} subscription(s) could not be renewed. Check Application Insights.`);
      }

    } catch (err) {
      context.error('[renewWebhooks] Unhandled error:', err);
    }
  },
});

async function getGraphToken(tenantId: string, clientId: string, clientSecret: string): Promise<string> {
  const url  = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    grant_type:    'client_credentials',
    client_id:     clientId,
    client_secret: clientSecret,
    scope:         'https://graph.microsoft.com/.default',
  });
  const res  = await fetch(url, { method: 'POST', body });
  const json = await res.json() as { access_token: string; error?: string };
  if (json.error) throw new Error(`Token error: ${JSON.stringify(json)}`);
  return json.access_token;
}

interface GraphSubscription {
  id: string;
  expirationDateTime: string;
  resource: string;
  changeType: string;
}
