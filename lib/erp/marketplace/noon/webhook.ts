import "server-only";
import { noonFetch } from "./client";
import { ensureNoonWebhookSecret } from "@/lib/saas/noon-config";
import { getIntegrationConfig } from "@/lib/saas/integration-config";

// Noon Event Notifications: register our HTTPS webhook as a destination so Noon pushes
// order/return/stock events to us automatically (instead of the owner registering the URL
// by hand). Noon has NO settlement/payout/invoice API — financial reconciliation for Noon
// stays manual (CSV import); this webhook covers the operational events it DOES emit.
// The receiver authenticates by the ?key= shared secret, so the destination URL carries it.
// Best-effort: any failure (unconfigured, unknown schema, network) is swallowed — the manual
// registration remains the fallback and connect never breaks.

const LIST_EVENT_TYPES_PATH = "/v1/event-type/list";
const CREATE_DESTINATION_PATH = "/v1/destination/https-destination/create";

/** Best-effort: fetch all subscribable event-type ids so we register for everything Noon
 *  emits (orders, returns, stock, offers). Returns [] on any failure. */
async function allEventTypes(credentialJson: string): Promise<string[]> {
  try {
    const res = await noonFetch<unknown>(credentialJson, LIST_EVENT_TYPES_PATH, { method: "GET" });
    // Response shape isn't documented; pull ids defensively from common shapes.
    const arr = Array.isArray(res) ? res : ((res as { data?: unknown[]; event_types?: unknown[] })?.data ?? (res as { event_types?: unknown[] })?.event_types ?? []);
    return (arr as unknown[])
      .map((e) => (typeof e === "string" ? e : (e as { id?: string; code?: string; name?: string })?.id ?? (e as { code?: string })?.code ?? (e as { name?: string })?.name))
      .filter((x): x is string => typeof x === "string" && !!x);
  } catch { return []; }
}

/** Register the app's webhook URL as a Noon HTTPS destination subscribed to all event types.
 *  Returns the destination id if Noon reports one. Never throws. */
export async function ensureNoonWebhook(credentialJson: string): Promise<{ destinationId?: string } | { error: string }> {
  const appUrl = process.env.APP_URL;
  const secret = await ensureNoonWebhookSecret(); // auto-generates on first use
  if (!appUrl || !secret) return { error: "APP_URL غير مضبوط" };
  // An admin redirect/base override can also drive the webhook host.
  const base = ((await getIntegrationConfig("NOON")).redirectUri?.replace(/\/api\/.*$/, "") || appUrl).replace(/\/$/, "");
  const url = `${base}/api/erp/marketplace/noon/webhook?key=${encodeURIComponent(secret)}`;
  const events = await allEventTypes(credentialJson); // subscribe to everything Noon emits
  try {
    const res = await noonFetch<{ id?: string; destination_id?: string; data?: { id?: string } }>(credentialJson, CREATE_DESTINATION_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "sellerctrl", url, secret, ...(events.length ? { events } : {}) }),
    });
    return { destinationId: res.id ?? res.destination_id ?? res.data?.id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "تعذّر تسجيل ويب‌هوك نون" };
  }
}
