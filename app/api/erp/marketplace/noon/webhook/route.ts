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

// Noon FBPI order webhook. Noon POSTs { metadata: { project_code }, payload: { order_nr } }
// on each order event — the payload carries ONLY the order_nr, so we resolve the tenant
// by project_code, GET the full order with that tenant's credentials, and ingest it as
// a DRAFT sales order (no session here → never auto-fulfils; a later sync/human advances
// it). Idempotent via (org, channel, externalId) inside ingestOrders.

type WebhookBody = {
  event_type?: string;
  metadata?: { project_code?: string };
  payload?: { order_nr?: string };
};

const ok = (msg = "ok") => new Response(JSON.stringify({ ok: true, msg }), { status: 200, headers: { "content-type": "application/json" } });
const bad = (status: number, error: string) => new Response(JSON.stringify({ ok: false, error }), { status, headers: { "content-type": "application/json" } });

export async function POST(req: Request) {
  // Mandatory shared-secret gate (fail-closed): owner sets it in /admin/integrations
  // (or env) and registers the webhook URL with ?key=… — Noon has no signature scheme,
  // so an unset secret means we can't authenticate the caller and reject. Constant-time.
  const secret = await getNoonWebhookSecret();
  if (!secret) return bad(503, "webhook secret not configured");
  if (!secretEquals(new URL(req.url).searchParams.get("key"), secret)) return bad(401, "unauthorized");

  let body: WebhookBody;
  try { body = (await req.json()) as WebhookBody; } catch { return bad(400, "bad json"); }

  const projectCode = body.metadata?.project_code?.trim();
  const orderNr = body.payload?.order_nr?.trim();
  // Always 200 on a payload we can't act on — a non-2xx makes Noon retry a poison event.
  if (!projectCode || !orderNr) return ok("ignored: missing project_code/order_nr");

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
      const p = await ensureNoonPlatform(cred.orgId);
      const ctx: PlatformCtx = {
        platformId: p.platformId, customerId: p.customerId, warehouseId: p.warehouseId,
        channel: "NOON", label: "نون", autoMode: "draft",
      };
      await ingestOrders(cred.orgId, null, ctx, [order]);
    });
    return ok("ingested");
  } catch (e) {
    // Log + 200: a transient GetFbpiOrder failure shouldn't wedge Noon into retrying
    // forever; the periodic reconcile/backfill catches a missed order later.
    console.error("[noon-webhook] order ingest failed:", e instanceof Error ? e.message : e);
    return ok("deferred: fetch failed");
  }
}
