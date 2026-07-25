import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { salesOrders, salesOrderLines } from "@/db/schema";

/**
 * Stock availability with reservations:
 *   available = on-hand − reserved
 *   reserved  = undelivered qty of open (non-cancelled) sales orders
 * Lets the UI warn when a product is committed to other orders even if it is
 * physically in stock. Item-level (across warehouses) — matches how the user
 * thinks about "available to sell".
 */
export type ItemAvailability = {
  onHand: number;
  reserved: number;
  available: number;
  reservedBy: { orderId: string; number: string; qty: number }[];
};

const r4 = (n: number) => Math.round(n * 10000) / 10000;

export async function getAvailability(orgId: string, itemIds: string[]): Promise<Map<string, ItemAvailability>> {
  const ids = [...new Set(itemIds.filter(Boolean))];
  const map = new Map<string, ItemAvailability>();
  if (ids.length === 0) return map;

  // On-hand = Σ latest running balance per (item, warehouse).
  const idList = sql.join(ids.map((id) => sql`${id}`), sql`, `);
  const onHandRows = await db.execute<{ item_id: string; qty: string }>(sql`
    SELECT item_id, COALESCE(SUM(bal), 0) AS qty FROM (
      SELECT DISTINCT ON (item_id, warehouse_id) item_id, balance_quantity AS bal
      FROM stock_movements
      WHERE organization_id = ${orgId} AND item_id IN (${idList})
      ORDER BY item_id, warehouse_id, created_at DESC, split_part(number, '-', 3)::int DESC
    ) t GROUP BY item_id`);
  const onHand = new Map((onHandRows.rows as { item_id: string; qty: string }[]).map((r) => [r.item_id, Number(r.qty)]));

  // Reserved = unfulfilled qty per open sales order line.
  // ponytail: DRAFT orders reserve too (only CANCELLED is excluded) — deliberate.
  // Reserving early is the no-oversell side; excluding DRAFT would free that stock
  // for another sale and risk overselling once the draft is confirmed. Flip to also
  // exclude DRAFT only if the business wants drafts to be non-committal quotes.
  // INVOICED excluded: a direct order→invoice posts stock via the invoice without
  // ever advancing deliveredQty — left in, that order "reserves" its full qty
  // forever (double-counted: on-hand already dropped AND still reserved).
  // GREATEST(delivered, invoiced) covers mixed partial states the same way.
  const resRows = await db
    .select({
      itemId: salesOrderLines.itemId,
      orderId: salesOrders.id,
      number: salesOrders.number,
      qty: sql<string>`sum(${salesOrderLines.quantity} - GREATEST(${salesOrderLines.deliveredQty}, ${salesOrderLines.invoicedQty}))`,
    })
    .from(salesOrderLines)
    .innerJoin(salesOrders, eq(salesOrders.id, salesOrderLines.salesOrderId))
    .where(and(eq(salesOrders.organizationId, orgId), notInArray(salesOrders.status, ["CANCELLED", "INVOICED"]), inArray(salesOrderLines.itemId, ids)))
    .groupBy(salesOrderLines.itemId, salesOrders.id, salesOrders.number);

  const reservedBy = new Map<string, { orderId: string; number: string; qty: number }[]>();
  const reservedTotal = new Map<string, number>();
  for (const r of resRows) {
    const q = Number(r.qty);
    if (q <= 1e-9) continue;
    const arr = reservedBy.get(r.itemId) ?? [];
    arr.push({ orderId: r.orderId, number: r.number, qty: q });
    reservedBy.set(r.itemId, arr);
    reservedTotal.set(r.itemId, (reservedTotal.get(r.itemId) ?? 0) + q);
  }

  for (const id of ids) {
    const oh = onHand.get(id) ?? 0;
    const rv = reservedTotal.get(id) ?? 0;
    map.set(id, { onHand: r4(oh), reserved: r4(rv), available: r4(oh - rv), reservedBy: (reservedBy.get(id) ?? []).sort((a, b) => b.qty - a.qty) });
  }
  return map;
}
