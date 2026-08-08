import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { platformCredentials } from "@/db/schema";
import { withOrgScope, withPlatformScope } from "@/lib/db-scope";
import { decryptSecret } from "@/lib/crypto";
import { ensureNoonPlatform } from "@/lib/erp/platform-provision";
import { fetchNoonOrder } from "@/lib/erp/marketplace/noon/orders";
import { fetchNoonReturn } from "@/lib/erp/marketplace/noon/returns";
import { ingestOrders, type PlatformCtx } from "@/lib/erp/marketplace/ingest";
import { upsertPlatformReturns, processPlatformReturns } from "@/lib/erp/returns-core";
import { getNoonWebhookSecret } from "@/lib/saas/noon-config";
import { secretEquals } from "@/lib/crypto";
import type { Credential } from "@/lib/erp/marketplace/connector";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Noon FBPI event webhook. Noon POSTs { event_type, metadata: { project_code }, payload }
// per event — the payload carries only an id (order_nr OR return_nr), so we resolve the
// tenant by project_code, GET the full record with that tenant's credentials, and:
//   • ORDER event  → ingest a DRAFT sales order (never auto-fulfils; a later sync/human
//     advances it). Idempotent via (org, channel, externalId) inside ingestOrders.
//   • RETURN event → upsert the return + create a DRAFT مرتجع against the original order's
//     posted invoice (processPlatformReturns). Idempotent via the return dedupKey.
// A return whose order isn't invoiced yet stays unclaimed and is re-checked opportunistically
// on the next event.

// Noon's real event types (from the destination subscription UI): namespace FBPI →
// ORDER_SYNC (orders), namespace RETURNS → REFERENCE_UPDATE (returns). The event_type
// string doesn't contain "return", so we route by BOTH the event name and the namespace.
type WebhookBody = {
  event_type?: string;
  event_name?: string;
  namespace?: string;
  metadata?: { project_code?: string; namespace?: string; event_type?: string };
  payload?: Record<string, unknown> & { order_nr?: string; return_nr?: string; fbpi_return_nr?: string; return_reference?: string };
  key?: string;
};

const ok = (msg = "ok") => new Response(JSON.stringify({ ok: true, msg }), { status: 200, headers: { "content-type": "application/json" } });
const bad = (status: number, error: string) => new Response(JSON.stringify({ ok: false, error }), { status, headers: { "content-type": "application/json" } });

// Noon's destination UI attaches the shared secret as a Key/Value credential — and how it
// arrives on the wire isn't documented (header vs body vs a ?key= you bake into the URL).
// So we accept the secret from any of them. Register the credential with Key = "key" (or
// just put ?key=<secret> in the Destination URL) — either way this authenticates.
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
  // Mandatory shared-secret gate (fail-closed): owner sets it in /admin/integrations (or
  // env) and enters the same value as the destination credential — Noon has no signature
  // scheme, so an unset secret means we can't authenticate the caller and reject.
  const secret = await getNoonWebhookSecret();
  if (!secret) return bad(503, "webhook secret not configured");

  let body: WebhookBody;
  try { body = (await req.json()) as WebhookBody; } catch { return bad(400, "bad json"); }

  // Constant-time compare, secret accepted from URL / header / body (see providedKey).
  if (!secretEquals(providedKey(req, body), secret)) return bad(401, "unauthorized");

  // ponytail: TEMP diagnostic — logs the real Noon event schema so we can finalise the
  // field mapping from a live event, then trim to a one-line summary. Remove once mapped.
  console.log("[noon-webhook] event:", JSON.stringify({
    event_type: body.event_type, event_name: body.event_name, namespace: body.namespace,
    metadata: body.metadata, payload: body.payload,
  }).slice(0, 1500));

  const projectCode = body.metadata?.project_code?.trim();
  // Always 200 on a payload we can't act on — a non-2xx makes Noon retry a poison event.
  if (!projectCode) return ok("ignored: missing project_code");

  // Route by event name AND namespace (Noon: FBPI/ORDER_SYNC vs RETURNS/REFERENCE_UPDATE).
  const evt = `${body.event_type ?? ""} ${body.event_name ?? ""} ${body.namespace ?? ""} ${body.metadata?.namespace ?? ""} ${body.metadata?.event_type ?? ""}`.toLowerCase();
  const p = body.payload ?? {};
  const orderNr = (p.order_nr ?? (p.mp_order_nr as string | undefined) ?? (p.fbpi_order_nr as string | undefined))?.toString().trim();
  const returnNr = (p.return_nr ?? p.fbpi_return_nr ?? p.return_reference ?? (p.reference_nr as string | undefined) ?? (p.mp_return_nr as string | undefined))?.toString().trim();
  const isReturn = !!returnNr || evt.includes("return") || evt.includes("refund") || evt.includes("reference");
  if (!orderNr && !returnNr) return ok("ignored: no order_nr/return_nr");

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

  // ── RETURN event → DRAFT مرتجع (or park unclaimed until the order is invoiced) ──
  if (isReturn) {
    if (!returnNr) return ok("ignored: return event without return_nr");
    try {
      const rows = await fetchNoonReturn(credential, returnNr); // network, unscoped
      if (rows.length === 0) return ok("ignored: empty return");
      await withOrgScope(cred.orgId, false, async () => {
        await ensureNoonPlatform(cred.orgId);
        await upsertPlatformReturns(cred.orgId, rows, "NOON");
        await processPlatformReturns(cred.orgId);
      });
      return ok("return ingested");
    } catch (e) {
      console.error("[noon-webhook] return ingest failed:", e instanceof Error ? e.message : e);
      return ok("deferred: return fetch failed");
    }
  }

  // ── ORDER event → DRAFT sales order ──
  try {
    const order = await fetchNoonOrder(credential, orderNr!); // network, unscoped
    if (!order.externalId || order.lines.length === 0) return ok("ignored: empty order");

    await withOrgScope(cred.orgId, false, async () => {
      const p = await ensureNoonPlatform(cred.orgId);
      const ctx: PlatformCtx = {
        platformId: p.platformId, customerId: p.customerId, warehouseId: p.warehouseId,
        channel: "NOON", label: "نون", autoMode: "draft",
      };
      await ingestOrders(cred.orgId, null, ctx, [order]);
      // A return that arrived before this order was invoiced sits unclaimed — cheap to
      // re-check now that order activity happened (no-op when nothing is pending).
      await processPlatformReturns(cred.orgId);
    });
    return ok("ingested");
  } catch (e) {
    // Log + 200: a transient GetFbpiOrder failure shouldn't wedge Noon into retrying
    // forever; the periodic reconcile/backfill catches a missed order later.
    console.error("[noon-webhook] order ingest failed:", e instanceof Error ? e.message : e);
    return ok("deferred: fetch failed");
  }
}
