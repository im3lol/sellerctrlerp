import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { platformCredentials } from "@/db/schema";
import { withOrgScope, withPlatformScope } from "@/lib/db-scope";
import { decryptSecret } from "@/lib/crypto";
import { ensureNoonPlatform } from "@/lib/erp/platform-provision";
import { fetchNoonOrder } from "@/lib/erp/marketplace/noon/orders";
import { ingestOrders, type PlatformCtx } from "@/lib/erp/marketplace/ingest";
import { getNoonWebhookSecret } from "@/lib/saas/noon-config";
import { secretEquals } from "@/lib/crypto";
import type { Credential } from "@/lib/erp/marketplace/connector";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Noon Event-Notification webhook. Confirmed envelope (noon-docs.noonpartners.dev):
//   { event_schema_version, event_type: "NAMESPACE::EVENT", metadata: { project_code, … }, payload }
// Two subscribed events (verified against the official schema):
//   • FBPI::ORDER_SYNC        payload { order_nr }              → GET the full order, ingest a
//       DRAFT sales order (or park it in unmatched_orders when the product isn't linked).
//   • RETURNS::REFERENCE_UPDATE payload { barcode, barcode_type } → JUST a "return reference
//       barcode added" notice. It carries NO order/sku/qty and there is no barcode→return
//       lookup, so it can't build a credit note — returns stay manual (CSV → DRAFT). We
//       acknowledge + log it; the accounting-relevant return surfaces as an ORDER_SYNC
//       status change on the order itself.
// Idempotent orders via (org, channel, externalId) inside ingestOrders. Always 200 on a
// payload we can't act on — a non-2xx makes Noon retry a poison event.
type WebhookBody = {
  event_type?: string;
  metadata?: { project_code?: string };
  payload?: Record<string, unknown> & { order_nr?: string; barcode?: string; barcode_type?: string };
  key?: string;
};

const ok = (msg = "ok") => new Response(JSON.stringify({ ok: true, msg }), { status: 200, headers: { "content-type": "application/json" } });
const bad = (status: number, error: string) => new Response(JSON.stringify({ ok: false, error }), { status, headers: { "content-type": "application/json" } });

// Noon attaches the shared secret as a Key/Value destination credential; how it arrives on
// the wire isn't documented (header vs query vs body), so accept it from any of them.
function providedKey(req: Request, body: WebhookBody): string | null {
  const q = new URL(req.url).searchParams.get("key");
  if (q) return q;
  const h = req.headers;
  for (const name of ["key", "x-webhook-key", "x-noon-key", "x-api-key"]) {
    const v = h.get(name);
    if (v) return v;
  }
  const auth = h.get("authorization");
  if (auth) return auth.replace(/^Bearer\s+/i, "").trim();
  if (typeof body.key === "string" && body.key) return body.key;
  return null;
}

export async function POST(req: Request) {
  // Mandatory shared-secret gate (fail-closed) — Noon has no signature scheme.
  const secret = await getNoonWebhookSecret();
  if (!secret) return bad(503, "webhook secret not configured");

  let body: WebhookBody;
  try { body = (await req.json()) as WebhookBody; } catch { return bad(400, "bad json"); }

  if (!secretEquals(providedKey(req, body), secret)) return bad(401, "unauthorized");

  const evt = (body.event_type ?? "").toUpperCase();
  const p = body.payload ?? {};
  const orderNr = p.order_nr?.toString().trim();
  console.log(`[noon-webhook] ${evt || "?"} proj=${body.metadata?.project_code ?? "-"} order_nr=${orderNr ?? "-"} barcode=${p.barcode ?? "-"}`);

  const projectCode = body.metadata?.project_code?.trim();
  if (!projectCode) return ok("ignored: missing project_code");

  // RETURNS::REFERENCE_UPDATE — barcode-only, can't build a credit note (see header note).
  if (evt.includes("REFERENCE") || evt.includes("RETURN") || evt.includes("REFUND")) {
    return ok("return reference noted (barcode only — returns handled manually)");
  }

  // FBPI::ORDER_SYNC (and any future order event) — needs an order_nr.
  if (!orderNr) return ok("ignored: no order_nr");

  // Resolve the tenant from project_code (stored plaintext in sellerId at connect).
  const [cred] = await withPlatformScope(() =>
    db.select({ orgId: platformCredentials.organizationId, token: platformCredentials.refreshToken })
      .from(platformCredentials)
      .where(and(eq(platformCredentials.provider, "noon"), eq(platformCredentials.sellerId, projectCode)))
      .limit(1));
  if (!cred) return ok("ignored: unknown project_code");

  const refreshToken = decryptSecret(cred.token);
  if (!refreshToken) return ok("ignored: undecryptable credential");
  const credential: Credential = { refreshToken, sellerId: projectCode, marketplaceId: null, region: "eg" };

  try {
    const order = await fetchNoonOrder(credential, orderNr); // network, unscoped
    if (!order.externalId || order.lines.length === 0) return ok("ignored: empty order");

    await withOrgScope(cred.orgId, false, async () => {
      const plat = await ensureNoonPlatform(cred.orgId);
      const ctx: PlatformCtx = {
        platformId: plat.platformId, customerId: plat.customerId, warehouseId: plat.warehouseId,
        channel: "NOON", label: "نون", autoMode: "draft",
      };
      await ingestOrders(cred.orgId, null, ctx, [order]);
    });
    return ok("ingested");
  } catch (e) {
    // Log + 200: a transient GetFbpiOrder failure shouldn't wedge Noon into retrying forever.
    console.error("[noon-webhook] order ingest failed:", e instanceof Error ? e.message : e);
    return ok("deferred: fetch failed");
  }
}
