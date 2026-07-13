import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { platformCredentials } from "@/db/schema";
import { prepareSync, markSync, syncOrdersCore, incrementalFrom } from "@/lib/erp/marketplace/sync-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Near-real-time auto-sync (Vercel Cron, every minute, guarded by CRON_SECRET).
 * Kept intentionally LIGHT — new orders only, incrementally — so each run finishes
 * in seconds and never holds DB/API resources. The heavy product/catalog refresh
 * runs once a day in /api/cron; inventory stays manual (needs confirmation).
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const conns = await db.select({
    orgId: platformCredentials.organizationId, provider: platformCredentials.provider,
    lastSyncAt: platformCredentials.lastSyncAt, connectedAt: platformCredentials.connectedAt,
  }).from(platformCredentials).where(eq(platformCredentials.autoSync, true));

  const now = Date.now();
  let orders = 0, ordersRun = 0, errors = 0;

  for (const c of conns) {
    const prep = await prepareSync(c.orgId, c.provider.toUpperCase());
    if ("error" in prep) { errors++; continue; }
    if (!prep.flags.orders || !prep.connector.fetchOrders) continue;

    const from = incrementalFrom(c.lastSyncAt ? new Date(c.lastSyncAt) : null, c.connectedAt ? new Date(c.connectedAt) : null, now);
    const r = await syncOrdersCore(prep, null, { from, to: new Date(now) });
    ordersRun++;
    if (r.ok) { orders += r.created; await markSync(c.orgId, c.provider, { lastSyncStatus: "auto" }); }
    else errors++;
  }

  return Response.json({ ok: true, connections: conns.length, ordersRun, newOrders: orders, errors });
}
