import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { platformCredentials } from "@/db/schema";
import { prepareSync, markSync, syncOrdersCore, syncProductsCore, incrementalFrom } from "@/lib/erp/marketplace/sync-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PRODUCTS_EVERY_MS = 24 * 60 * 60 * 1000; // daily product/catalog refresh

/**
 * Near-real-time auto-sync (Vercel Cron, every minute, guarded by CRON_SECRET).
 * For each connected marketplace with auto-sync on: pull new orders incrementally
 * (since last sync), and refresh products at most daily. Inventory stays manual
 * (reconciliation needs user confirmation).
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const conns = await db.select({
    orgId: platformCredentials.organizationId, provider: platformCredentials.provider,
    lastSyncAt: platformCredentials.lastSyncAt, productsSyncedAt: platformCredentials.productsSyncedAt,
    connectedAt: platformCredentials.connectedAt,
  }).from(platformCredentials).where(eq(platformCredentials.autoSync, true));

  const now = Date.now();
  let orders = 0, ordersRun = 0, productsRun = 0, errors = 0;

  for (const c of conns) {
    const prep = await prepareSync(c.orgId, c.provider.toUpperCase());
    if ("error" in prep) { errors++; continue; }

    // Orders — incremental (since last sync, minus a small overlap).
    if (prep.flags.orders && prep.connector.fetchOrders) {
      const from = incrementalFrom(c.lastSyncAt ? new Date(c.lastSyncAt) : null, c.connectedAt ? new Date(c.connectedAt) : null, now);
      const r = await syncOrdersCore(prep, null, { from, to: new Date(now) });
      ordersRun++;
      if (r.ok) { orders += r.created; await markSync(c.orgId, c.provider, { lastSyncStatus: "auto" }); }
      else errors++;
    }

    // Products — at most once per day.
    if (prep.flags.products && prep.connector.fetchProducts && (!c.productsSyncedAt || now - new Date(c.productsSyncedAt).getTime() > PRODUCTS_EVERY_MS)) {
      const r = await syncProductsCore(prep);
      productsRun++;
      if (r.ok) await markSync(c.orgId, c.provider, { productsSyncedAt: new Date() });
      else errors++;
    }
  }

  return Response.json({ ok: true, connections: conns.length, ordersRun, newOrders: orders, productsRun, errors });
}
