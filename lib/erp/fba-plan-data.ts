import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { inventoryAudits } from "@/db/schema";
import type { FbaPlanInput } from "@/lib/erp/fba-plan";

/**
 * The inputs for an FBA shipment plan. Call inside the org's RLS scope.
 *
 * Amazon's side comes from the latest completed FBA audit — Amazon's own count of what is
 * sellable and what is inbound. With no audit yet it falls back to the ERP's balance of the
 * FBA warehouse and assumes nothing is inbound; the page says which one it used. Sales are
 * the units that left the FBA warehouse, so orders shipped from my own warehouse (FBM)
 * don't inflate what Amazon needs.
 */
export async function getFbaPlanInputs(
  orgId: string, fbaWarehouseId: string, sourceWarehouseId: string, windowDays: number,
): Promise<{ rows: FbaPlanInput[]; auditAt: Date | null }> {
  const [audit] = await db.select({ id: inventoryAudits.id, at: sql<Date>`coalesce(${inventoryAudits.finishedAt}, ${inventoryAudits.createdAt})` })
    .from(inventoryAudits)
    .where(and(eq(inventoryAudits.organizationId, orgId), eq(inventoryAudits.status, "OK"), eq(inventoryAudits.provider, "amazon")))
    .orderBy(desc(inventoryAudits.createdAt)).limit(1);
  const since = new Date(Date.now() - windowDays * 86_400_000);

  const { rows } = await db.execute<{
    id: string; code: string; name: string; sku: string | null; asin: string | null;
    available: string; inbound: string; sold: string; source_on_hand: string;
  }>(sql`
    WITH latest AS (
      SELECT DISTINCT ON (item_id, warehouse_id) item_id, warehouse_id, balance_quantity
      FROM stock_movements
      WHERE organization_id = ${orgId} AND warehouse_id IN (${fbaWarehouseId}, ${sourceWarehouseId})
      ORDER BY item_id, warehouse_id, created_at DESC, split_part(number, '-', 3)::int DESC
    ), sold AS (
      SELECT item_id, SUM(quantity) AS sold FROM stock_movements
      WHERE organization_id = ${orgId} AND warehouse_id = ${fbaWarehouseId} AND type = 'OUT'
        AND reference_type IN ('DELIVERY','SALES_INVOICE') AND date >= ${since}
      GROUP BY item_id
    ), fba AS (
      -- One item can carry several SKUs at Amazon; the plan is per item.
      SELECT item_id, SUM(available) AS available, SUM(inbound) AS inbound, MIN(code) AS sku, MIN(asin) AS asin
      FROM inventory_audit_lines
      WHERE organization_id = ${orgId} AND audit_id = ${audit?.id ?? null} AND item_id IS NOT NULL
      GROUP BY item_id
    )
    SELECT i.id, i.code, coalesce(i.name_ar, i.code) AS name, f.sku, f.asin,
           ${audit ? sql`coalesce(f.available, 0)` : sql`coalesce(lf.balance_quantity, 0)`} AS available,
           coalesce(f.inbound, 0) AS inbound, coalesce(s.sold, 0) AS sold,
           coalesce(ls.balance_quantity, 0) AS source_on_hand
    FROM items i
    LEFT JOIN fba f ON f.item_id = i.id
    LEFT JOIN sold s ON s.item_id = i.id
    LEFT JOIN latest lf ON lf.item_id = i.id AND lf.warehouse_id = ${fbaWarehouseId}
    LEFT JOIN latest ls ON ls.item_id = i.id AND ls.warehouse_id = ${sourceWarehouseId}
    WHERE i.organization_id = ${orgId} AND i.is_active = true
      AND (f.item_id IS NOT NULL OR s.item_id IS NOT NULL)
  `);

  return {
    auditAt: audit ? new Date(audit.at) : null,
    rows: rows.map((r) => ({
      itemId: r.id, code: r.code, name: r.name, sku: r.sku, asin: r.asin,
      fbaAvailable: Number(r.available), fbaInbound: Number(r.inbound),
      soldAtAmazon: Number(r.sold), sourceOnHand: Number(r.source_on_hand),
    })),
  };
}
