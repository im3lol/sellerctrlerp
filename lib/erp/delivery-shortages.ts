import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

// Stock coverage for DRAFT إذون الصرف: aggregate the quantities every draft
// delivery wants per (item, warehouse) and compare with the CURRENT on-hand
// balance. Aggregated on purpose — several drafts competing for the same stock
// are collectively short even if each alone would fit.

export type DeliveryShortage = {
  itemId: string;
  code: string;
  name: string | null;
  warehouseId: string;
  warehouseName: string | null;
  needed: number;
  onHand: number;
  missing: number;
};

export type DeliveryShortages = {
  shortages: DeliveryShortage[];
  /** DRAFT delivery ids that contain at least one short (item, warehouse) line. */
  shortDeliveryIds: string[];
};

const EPS = 1e-9;

export async function computeDeliveryShortages(orgId: string): Promise<DeliveryShortages> {
  // 1) What the drafts need, per (item, effective warehouse), + which drafts touch each pair.
  const needed = await db.execute<{
    item_id: string; warehouse_id: string; needed: string; dn_ids: string[];
    code: string; name: string | null; warehouse_name: string | null;
  }>(sql`
    SELECT dnl.item_id,
           COALESCE(dnl.warehouse_id, dn.warehouse_id) AS warehouse_id,
           SUM(dnl.quantity) AS needed,
           ARRAY_AGG(DISTINCT dn.id) AS dn_ids,
           i.code, i.name_ar AS name, w.name_ar AS warehouse_name
    FROM delivery_note_lines dnl
    JOIN delivery_notes dn ON dn.id = dnl.delivery_note_id
    JOIN items i ON i.id = dnl.item_id
    LEFT JOIN warehouses w ON w.id = COALESCE(dnl.warehouse_id, dn.warehouse_id)
    WHERE dn.organization_id = ${orgId} AND dn.status = 'DRAFT'
      AND COALESCE(dnl.warehouse_id, dn.warehouse_id) IS NOT NULL
    GROUP BY dnl.item_id, COALESCE(dnl.warehouse_id, dn.warehouse_id), i.code, i.name_ar, w.name_ar
  `);
  if (needed.rows.length === 0) return { shortages: [], shortDeliveryIds: [] };

  // 2) Current on-hand per pair: the LATEST running balance (same tie-break as
  //    priorBalance — created_at then the SM number's numeric tail).
  const itemIds = [...new Set(needed.rows.map((r) => r.item_id))];
  const balances = await db.execute<{ item_id: string; warehouse_id: string; qty: string }>(sql`
    SELECT DISTINCT ON (item_id, warehouse_id) item_id, warehouse_id, balance_quantity AS qty
    FROM stock_movements
    WHERE organization_id = ${orgId} AND item_id IN (${sql.join(itemIds.map((i) => sql`${i}`), sql`, `)})
    ORDER BY item_id, warehouse_id, created_at DESC, split_part(number, '-', 3)::int DESC
  `);
  const onHandBy = new Map(balances.rows.map((b) => [`${b.item_id}|${b.warehouse_id}`, Number(b.qty)]));

  const shortages: DeliveryShortage[] = [];
  const shortDns = new Set<string>();
  for (const r of needed.rows) {
    const neededQty = Number(r.needed);
    const onHand = onHandBy.get(`${r.item_id}|${r.warehouse_id}`) ?? 0;
    const missing = neededQty - onHand;
    if (missing <= EPS) continue;
    shortages.push({
      itemId: r.item_id, code: r.code, name: r.name,
      warehouseId: r.warehouse_id, warehouseName: r.warehouse_name,
      needed: neededQty, onHand, missing: Math.round(missing * 1000) / 1000,
    });
    for (const id of r.dn_ids) shortDns.add(id);
  }
  return { shortages, shortDeliveryIds: [...shortDns] };
}
