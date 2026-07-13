import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { platformCredentials } from "@/db/schema";
import { prepareSync, markSync, syncOrdersCore, syncProductsCore, incrementalFrom, SYNC_OVERLAP_MS } from "@/lib/erp/marketplace/sync-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Near-real-time auto-sync (Vercel Cron, every minute, guarded by CRON_SECRET).
 * Kept LIGHT so each run finishes in seconds and never holds DB/API resources:
 *   • Orders — incremental (new orders since last sync).
 *   • Products — INCREMENTAL only (listings changed since last sync via
 *     lastUpdatedAfter), and only after an initial full sync has run (button or
 *     daily cron sets products_synced_at). Never a full re-scan here.
 * Inventory stays manual (needs confirmation); the heavy full product/catalog
 * reconciliation runs once a day in /api/cron.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const conns = await db.select({
    orgId: platformCredentials.organizationId, provider: platformCredentials.provider,
    lastSyncAt: platformCredentials.lastSyncAt, connectedAt: platformCredentials.connectedAt,
    productsSyncedAt: platformCredentials.productsSyncedAt,
  }).from(platformCredentials).where(eq(platformCredentials.autoSync, true));

  const now = Date.now();
  let orders = 0, ordersRun = 0, productsRun = 0, newProducts = 0, errors = 0;

  for (const c of conns) {
    const prep = await prepareSync(c.orgId, c.provider.toUpperCase());
    if ("error" in prep) { errors++; continue; }

    // Orders — incremental.
    if (prep.flags.orders && prep.connector.fetchOrders) {
      const from = incrementalFrom(c.lastSyncAt ? new Date(c.lastSyncAt) : null, c.connectedAt ? new Date(c.connectedAt) : null, now);
      const r = await syncOrdersCore(prep, null, { from, to: new Date(now) });
      ordersRun++;
      if (r.ok) { orders += r.created; await markSync(c.orgId, c.provider, { lastSyncStatus: "auto" }); }
      else errors++;
    }

    // Products — incremental, only after an initial full sync (products_synced_at set).
    if (prep.flags.products && prep.connector.fetchProducts && c.productsSyncedAt) {
      const since = new Date(new Date(c.productsSyncedAt).getTime() - SYNC_OVERLAP_MS);
      const r = await syncProductsCore(prep, since);
      productsRun++;
      if (r.ok) { newProducts += r.created; await markSync(c.orgId, c.provider, { productsSyncedAt: new Date() }); }
      else errors++;
    }
  }

  return Response.json({ ok: true, connections: conns.length, ordersRun, newOrders: orders, productsRun, newProducts, errors });
}
