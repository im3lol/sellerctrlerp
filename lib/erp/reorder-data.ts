import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { planReorder, chooseSupplier, type ReorderPlan, type ReorderStatus, type SupplierOffer } from "@/lib/erp/reorder";

export type ReorderParams = { windowDays: number; leadDays: number; coverDays: number };
export type ReorderRow = ReorderPlan & {
  itemId: string; code: string; name: string; onHand: number; inbound: number;
  supplierId: string | null; supplierName: string | null;
  /** The chosen supplier's lead time from the catalog, else the page's setting. */
  leadDays: number;
};

const RANK: Record<ReorderStatus, number> = { out: 0, critical: 1, low: 2, ok: 3 };

/**
 * The items that need ordering, worst first, each with the supplier to order from. One
 * source for the reorder page AND the purchase order it prefills, so the order carries the
 * quantities the page showed. Call inside the org's RLS scope.
 *
 * The supplier comes from the catalog (preferred first, else last ordered from — see
 * chooseSupplier), and so do its lead time and minimum order. An item nobody has put in
 * the catalog falls back to whoever it was last ordered from.
 */
export async function getReorderPlan(orgId: string, p: ReorderParams): Promise<ReorderRow[]> {
  const since = new Date(Date.now() - p.windowDays * 86_400_000);
  const { rows } = await db.execute<{
    id: string; code: string; name: string; min_stock: string; on_hand: string; sold: string; inbound: string;
    supplier_id: string | null; supplier_name: string | null;
  }>(sql`
    WITH latest AS (
      SELECT DISTINCT ON (item_id, warehouse_id) item_id, balance_quantity
      FROM stock_movements WHERE organization_id = ${orgId}
      ORDER BY item_id, warehouse_id, created_at DESC, split_part(number, '-', 3)::int DESC
    ), velocity AS (
      SELECT item_id, SUM(quantity) AS sold FROM stock_movements
      WHERE organization_id = ${orgId} AND type = 'OUT'
        AND reference_type IN ('DELIVERY','SALES_INVOICE') AND date >= ${since}
      GROUP BY item_id
    ), inbound AS (
      -- Units already on the way from the most recent FBA audit snapshot.
      SELECT item_id, SUM(inbound) AS inbound FROM inventory_audit_lines
      WHERE organization_id = ${orgId} AND item_id IS NOT NULL
        AND audit_id = (SELECT id FROM inventory_audits WHERE organization_id = ${orgId} AND status = 'OK' ORDER BY created_at DESC LIMIT 1)
      GROUP BY item_id
    ), last_sup AS (
      -- Who the item was last ordered from — the fallback when it isn't in the catalog.
      SELECT DISTINCT ON (pol.item_id) pol.item_id, po.supplier_id
      FROM purchase_order_lines pol JOIN purchase_orders po ON po.id = pol.purchase_order_id
      WHERE po.organization_id = ${orgId} AND po.status <> 'CANCELLED'
      ORDER BY pol.item_id, po.date DESC, po.created_at DESC
    )
    SELECT i.id, i.code, coalesce(i.name_ar, i.code) AS name, coalesce(i.min_stock, 0) AS min_stock,
           coalesce(sum(l.balance_quantity), 0) AS on_hand, coalesce(max(v.sold), 0) AS sold,
           coalesce(max(ib.inbound), 0) AS inbound, max(ls.supplier_id) AS supplier_id, max(s.name_ar) AS supplier_name
    FROM items i
    LEFT JOIN latest l ON l.item_id = i.id
    LEFT JOIN velocity v ON v.item_id = i.id
    LEFT JOIN inbound ib ON ib.item_id = i.id
    LEFT JOIN last_sup ls ON ls.item_id = i.id
    LEFT JOIN suppliers s ON s.id = ls.supplier_id
    WHERE i.organization_id = ${orgId} AND i.is_active = true
    GROUP BY i.id
  `);

  const { rows: catalog } = await db.execute<{
    item_id: string; supplier_id: string; name: string; is_preferred: boolean; last_ordered_at: string | null;
    unit_price: string | null; lead_days: number | null; min_qty: string | null;
  }>(sql`
    SELECT si.item_id, si.supplier_id, s.name_ar AS name, si.is_preferred, si.last_ordered_at,
           si.unit_price, si.lead_days, si.min_qty
    FROM supplier_items si JOIN suppliers s ON s.id = si.supplier_id
    WHERE si.organization_id = ${orgId} AND s.is_active = true
  `);
  const offersByItem = new Map<string, SupplierOffer[]>();
  for (const c of catalog) {
    const list = offersByItem.get(c.item_id) ?? [];
    list.push({
      supplierId: c.supplier_id, supplierName: c.name, isPreferred: c.is_preferred,
      lastOrderedAt: c.last_ordered_at ? new Date(c.last_ordered_at) : null,
      unitPrice: c.unit_price != null ? Number(c.unit_price) : null,
      leadDays: c.lead_days, minQty: c.min_qty != null ? Number(c.min_qty) : null,
    });
    offersByItem.set(c.item_id, list);
  }

  return rows
    .map((r) => {
      const pick = chooseSupplier(offersByItem.get(r.id) ?? []);
      const leadDays = pick?.leadDays ?? p.leadDays;
      return {
        itemId: r.id, code: r.code, name: r.name,
        onHand: Number(r.on_hand), inbound: Number(r.inbound),
        supplierId: pick?.supplierId ?? r.supplier_id, supplierName: pick?.supplierName ?? r.supplier_name,
        leadDays,
        ...planReorder({
          onHand: Number(r.on_hand), soldInWindow: Number(r.sold), windowDays: p.windowDays,
          leadDays, coverDays: p.coverDays, minStock: Number(r.min_stock), inbound: Number(r.inbound),
          minOrderQty: pick?.minQty ?? undefined,
        }),
      };
    })
    .filter((r) => r.needsReorder)
    .sort((a, b) => RANK[a.status] - RANK[b.status] || a.daysOfCover - b.daysOfCover);
}
