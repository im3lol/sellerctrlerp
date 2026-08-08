import "server-only";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { platformRemovals } from "@/db/schema";
import { removalDedupKey, type RemovalRow } from "@/lib/erp/amazon-removals";

// Session-less FBA-removals engine (mirrors returns-core): upsert the report rows
// idempotently. Quantities of an in-progress removal grow over time, so a re-pull refreshes
// them — but never touches OUR workflow `status` (PENDING → RESTOCKED/DISPOSED once the
// trader acts). The caller establishes the org RLS scope.

export async function upsertPlatformRemovals(orgId: string, rows: RemovalRow[], channel: string): Promise<{ imported: number }> {
  if (rows.length === 0) return { imported: 0 };
  const values = rows.map((r) => ({
    organizationId: orgId, channel, removalOrderId: r.removalOrderId, orderType: r.orderType || null,
    orderStatus: r.orderStatus || null, sku: r.sku, fnsku: r.fnsku || null, disposition: r.disposition || null,
    requestedQty: String(r.requestedQty), disposedQty: String(r.disposedQty), shippedQty: String(r.shippedQty),
    requestDate: r.requestDate, dedupKey: removalDedupKey(r), raw: r as unknown, updatedAt: new Date(),
  }));
  // Same-report duplicate keys would trip ON CONFLICT twice in one statement.
  const byKey = new Map(values.map((v) => [v.dedupKey, v]));
  const merged = [...byKey.values()];
  let imported = 0;
  for (let i = 0; i < merged.length; i += 500) {
    const inserted = await db.insert(platformRemovals).values(merged.slice(i, i + 500))
      .onConflictDoUpdate({
        target: [platformRemovals.organizationId, platformRemovals.dedupKey],
        set: {
          orderStatus: sql`excluded.order_status`, requestedQty: sql`excluded.requested_qty`,
          disposedQty: sql`excluded.disposed_qty`, shippedQty: sql`excluded.shipped_qty`,
          raw: sql`excluded.raw`, updatedAt: sql`excluded.updated_at`,
          // never overwrite our workflow status once the trader acted on it
        },
      })
      .returning({ id: platformRemovals.id });
    imported += inserted.length;
  }
  return { imported };
}

export type PlatformRemovalRow = {
  id: string; channel: string; removalOrderId: string; orderType: string | null; sku: string;
  fnsku: string | null; disposition: string | null; disposedQty: number; shippedQty: number;
  requestDate: string | null; status: string;
};

/** The removals awaiting the trader's decision (PENDING). */
export async function getPlatformRemovals(orgId: string): Promise<PlatformRemovalRow[]> {
  const rows = await db.select({
    id: platformRemovals.id, channel: platformRemovals.channel, removalOrderId: platformRemovals.removalOrderId,
    orderType: platformRemovals.orderType, sku: platformRemovals.sku, fnsku: platformRemovals.fnsku,
    disposition: platformRemovals.disposition, disposedQty: platformRemovals.disposedQty,
    shippedQty: platformRemovals.shippedQty, requestDate: platformRemovals.requestDate, status: platformRemovals.status,
  }).from(platformRemovals)
    .where(and(eq(platformRemovals.organizationId, orgId), eq(platformRemovals.status, "PENDING")))
    .orderBy(desc(platformRemovals.requestDate)).limit(300);
  return rows.map((r) => ({
    id: r.id, channel: r.channel, removalOrderId: r.removalOrderId, orderType: r.orderType, sku: r.sku,
    fnsku: r.fnsku, disposition: r.disposition, disposedQty: Number(r.disposedQty), shippedQty: Number(r.shippedQty),
    requestDate: r.requestDate ? new Date(r.requestDate).toISOString() : null, status: r.status,
  }));
}

/** Count of removals not yet acted on (for UI badges / notifications). */
export async function pendingRemovalsCount(orgId: string): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)` }).from(platformRemovals)
    .where(and(eq(platformRemovals.organizationId, orgId), eq(platformRemovals.status, "PENDING"), ne(platformRemovals.status, "IGNORED")));
  return Number(r?.n ?? 0);
}
