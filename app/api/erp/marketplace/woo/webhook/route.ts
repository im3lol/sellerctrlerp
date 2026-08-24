import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { platformCredentials } from "@/db/schema";
import { withOrgScope, withPlatformScope } from "@/lib/db-scope";
import { ensureWooPlatform } from "@/lib/erp/platform-provision";
import { orderToDto, type WooOrder } from "@/lib/erp/marketplace/woo/orders";
import { verifyWooWebhook, validateStoreUrl } from "@/lib/erp/marketplace/woo/constants";
import { getWooWebhookSecret } from "@/lib/saas/woo-config";
import { ingestOrders, type PlatformCtx } from "@/lib/erp/marketplace/ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// WooCommerce order webhook. WC POSTs the FULL order JSON (order.created / order.updated) and
// signs the RAW body with X-WC-Webhook-Signature = base64(HMAC-SHA256(body, secret)). We verify
// with the owner-set secret, resolve the tenant by the X-WC-Webhook-Source store URL (stored
// plaintext in sellerId at connect), map the payload, and ingest as a DRAFT order (no session →
// never auto-fulfils). Idempotent via (org, channel, externalId) inside ingestOrders.

const ok = (msg = "ok") => new Response(JSON.stringify({ ok: true, msg }), { status: 200, headers: { "content-type": "application/json" } });
const bad = (status: number, error: string) => new Response(JSON.stringify({ ok: false, error }), { status, headers: { "content-type": "application/json" } });

export async function POST(req: Request) {
  // Fail-closed: without a configured secret we can't authenticate the caller.
  const secret = await getWooWebhookSecret();
  if (!secret) return bad(503, "webhook secret not configured");

  const raw = await req.text();
  const signature = req.headers.get("x-wc-webhook-signature");
  if (!verifyWooWebhook(raw, signature, secret)) return bad(401, "unauthorized");

  // WC pings the endpoint on webhook creation with a tiny non-order body ("webhook_id":…).
  let body: WooOrder & { webhook_id?: number };
  try { body = JSON.parse(raw); } catch { return bad(400, "bad json"); }
  if (!body?.id || body.webhook_id) return ok("ignored: ping / non-order");

  // Resolve the tenant by the store origin (plaintext sellerId). Header is the store base URL.
  const source = validateStoreUrl(req.headers.get("x-wc-webhook-source") || "");
  if (!source) return ok("ignored: no source");
  const [cred] = await withPlatformScope(() =>
    db.select({ orgId: platformCredentials.organizationId })
      .from(platformCredentials)
      .where(and(eq(platformCredentials.provider, "woo"), eq(platformCredentials.sellerId, source)))
      .limit(1));
  if (!cred) return ok("ignored: unknown store");

  try {
    const order = orderToDto(body);
    if (!order.externalId || order.lines.length === 0) return ok("ignored: empty order");
    await withOrgScope(cred.orgId, false, async () => {
      const p = await ensureWooPlatform(cred.orgId);
      const ctx: PlatformCtx = {
        platformId: p.platformId, customerId: p.customerId, warehouseId: p.warehouseId,
        channel: "WOO", label: "ووكومرس", autoMode: "draft",
      };
      await ingestOrders(cred.orgId, null, ctx, [order]);
    });
    return ok("ingested");
  } catch (e) {
    console.error("[woo-webhook] order ingest failed:", e instanceof Error ? e.message : e);
    return ok("deferred: ingest failed");
  }
}
