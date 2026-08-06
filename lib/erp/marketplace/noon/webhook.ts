import "server-only";
import { noonFetch } from "./client";
import { getNoonWebhookSecret } from "@/lib/saas/noon-config";
import { getIntegrationConfig } from "@/lib/saas/integration-config";

// Noon Event Notifications: register our HTTPS webhook as a destination so Noon pushes
// order events to us automatically (instead of the owner registering the URL by hand).
// The receiver at /api/erp/marketplace/noon/webhook authenticates by the ?key= shared
// secret (Noon has no signature scheme), so the destination URL carries that key.
// Best-effort: any failure (unconfigured, unknown schema, network) is swallowed — the
// manual registration remains the reliable fallback, and connect never breaks.

const CREATE_DESTINATION_PATH = "/v1/destination/https-destination/create";

/** Register the app's webhook URL as a Noon HTTPS destination for this credential.
 *  Returns the destination id if Noon reports one. Never throws. */
export async function ensureNoonWebhook(credentialJson: string): Promise<{ destinationId?: string } | { error: string }> {
  const appUrl = process.env.APP_URL;
  const secret = await getNoonWebhookSecret();
  if (!appUrl || !secret) return { error: "APP_URL أو سرّ الويب‌هوك غير مضبوط" };
  // Allow an admin redirect/base override to also drive the webhook host if set.
  const base = ((await getIntegrationConfig("NOON")).redirectUri?.replace(/\/api\/.*$/, "") || appUrl).replace(/\/$/, "");
  const url = `${base}/api/erp/marketplace/noon/webhook?key=${encodeURIComponent(secret)}`;
  try {
    const res = await noonFetch<{ id?: string; destination_id?: string; data?: { id?: string } }>(credentialJson, CREATE_DESTINATION_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "sellerctrl", url, is_active: true }),
    });
    return { destinationId: res.id ?? res.destination_id ?? res.data?.id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "تعذّر تسجيل ويب‌هوك نون" };
  }
}
