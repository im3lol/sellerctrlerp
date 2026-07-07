import { and, eq, inArray, ne, sql } from "drizzle-orm";
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
      ORDER BY item_id, warehouse_id, created_at DESC, id DESC
    ) t GROUP BY item_id`);
  const onHand = new Map((onHandRows.rows as { item_id: string; qty: string }[]).map((r) => [r.item_id, Number(r.qty)]));

  // Reserved = undelivered qty per open sales order line.
  const resRows = await db
    .select({
      itemId: salesOrderLines.itemId,
      orderId: salesOrders.id,
      number: salesOrders.number,
      qty: sql<string>`sum(${salesOrderLines.quantity} - ${salesOrderLines.deliveredQty})`,
    })
    .from(salesOrderLines)
    .innerJoin(salesOrders, eq(salesOrders.id, salesOrderLines.salesOrderId))
    .where(and(eq(salesOrders.organizationId, orgId), ne(salesOrders.status, "CANCELLED"), inArray(salesOrderLines.itemId, ids)))
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
