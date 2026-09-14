import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { purchaseOrders, purchaseOrderLines, supplierItems } from "@/db/schema";
import { log } from "@/lib/log";

/**
 * Remember what a supplier charges for each item. A confirmed order is a real purchase
 * (price + when); an awarded quotation is a quoted price and lead time. A lead time or
 * code someone typed is never overwritten with nothing.
 *
 * Best-effort, inside a savepoint: a catalog write must never fail the order that
 * triggered it, nor poison the transaction it runs in. Call inside the org's scope.
 */
export async function recordSupplierPrices(
  orgId: string,
  supplierId: string,
  lines: { itemId: string; unitPrice: number }[],
  opts: { orderedAt?: Date; leadDays?: number | null } = {},
): Promise<void> {
  const byItem = new Map<string, number>();
  for (const l of lines) if (l.itemId && l.unitPrice > 0) byItem.set(l.itemId, l.unitPrice);
  if (!byItem.size) return;
  try {
    await db.transaction(async (tx) => {
      await tx.insert(supplierItems).values([...byItem].map(([itemId, unitPrice]) => ({
        organizationId: orgId, itemId, supplierId, unitPrice: String(unitPrice),
        leadDays: opts.leadDays ?? null, lastOrderedAt: opts.orderedAt ?? null,
      }))).onConflictDoUpdate({
        target: [supplierItems.organizationId, supplierItems.itemId, supplierItems.supplierId],
        set: {
          unitPrice: sql`excluded.unit_price`,
          leadDays: sql`coalesce(excluded.lead_days, ${supplierItems.leadDays})`,
          lastOrderedAt: sql`coalesce(excluded.last_ordered_at, ${supplierItems.lastOrderedAt})`,
          updatedAt: new Date(),
        },
      });
    });
  } catch (e) {
    log.warn("supplier_catalog.record_failed", { orgId, err: e });
  }
}

/** A purchase order was confirmed: its supplier sells these items at these prices, as of its date. */
export async function catalogFromOrder(orgId: string, purchaseOrderId: string): Promise<void> {
  const [po] = await db.select({ supplierId: purchaseOrders.supplierId, date: purchaseOrders.date }).from(purchaseOrders)
    .where(and(eq(purchaseOrders.id, purchaseOrderId), eq(purchaseOrders.organizationId, orgId))).limit(1);
  if (!po?.supplierId) return;
  const lines = await db.select({ itemId: purchaseOrderLines.itemId, unitPrice: purchaseOrderLines.unitPrice })
    .from(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, purchaseOrderId));
  await recordSupplierPrices(orgId, po.supplierId, lines.map((l) => ({ itemId: l.itemId, unitPrice: Number(l.unitPrice) })), { orderedAt: new Date(po.date) });
}
