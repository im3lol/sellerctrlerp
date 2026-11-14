"use server";

import { withOrgScope } from "@/lib/db-scope";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { warehouses, stockMovements, items } from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";

export type WarehouseStock = { warehouseId: string; name: string; qty: number };

/** One read request for a pasted range instead of a request for every row. */
export async function getPasteWarehouseStocksAction(itemIds: string[]): Promise<ActionState & { stocks?: Record<string, WarehouseStock[]> }> {
  if (!Array.isArray(itemIds) || itemIds.length > 300 || itemIds.some(id => typeof id !== "string" || id.length > 200)) return { error: "راجع تنسيق الخلايا المنسوخة" };
  const auth = await authorizeErp("sales.view");
  if ("error" in auth) return auth;
  if (!itemIds.length) return { ok: true, stocks: {} };
  return withOrgScope(auth.orgId, false, async () => {
    const valid = await db.select({ id: items.id }).from(items).where(and(eq(items.organizationId, auth.orgId), eq(items.isActive, true), inArray(items.id, itemIds)));
    if (!valid.length) return { ok: true, stocks: {} };
    const ids = valid.map(it => it.id);
    const whs = await db.select({ id: warehouses.id, name: warehouses.nameAr }).from(warehouses)
      .where(and(eq(warehouses.organizationId, auth.orgId), eq(warehouses.isActive, true))).orderBy(asc(warehouses.code));
    const balances = await db.selectDistinctOn([stockMovements.itemId, stockMovements.warehouseId], {
      itemId: stockMovements.itemId, warehouseId: stockMovements.warehouseId, bal: stockMovements.balanceQuantity,
    }).from(stockMovements).where(and(eq(stockMovements.organizationId, auth.orgId), inArray(stockMovements.itemId, ids)))
      .orderBy(stockMovements.itemId, stockMovements.warehouseId, desc(stockMovements.createdAt), desc(sql`CASE WHEN split_part(${stockMovements.number}, '-', 3) ~ '^[0-9]+$' THEN split_part(${stockMovements.number}, '-', 3)::numeric ELSE 0 END`));
    const byKey = new Map(balances.map(b => [`${b.itemId}|${b.warehouseId}`, Number(b.bal)]));
    return { ok: true, stocks: Object.fromEntries(ids.map(id => [id, whs.map(w => ({ warehouseId: w.id, name: w.name ?? "", qty: byKey.get(`${id}|${w.id}`) ?? 0 }))])) };
  });
}

/** Current on-hand quantity of an item in each active warehouse (0 where none). */
export async function getItemWarehouseStockAction(itemId: string): Promise<ActionState & { stock?: WarehouseStock[] }> {
  const auth = await authorizeErp("sales.view");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
    const whs = await db.select({ id: warehouses.id, name: warehouses.nameAr }).from(warehouses)
      .where(and(eq(warehouses.organizationId, auth.orgId), eq(warehouses.isActive, true))).orderBy(asc(warehouses.code));

    const sm = await db.select({ warehouseId: stockMovements.warehouseId, bal: stockMovements.balanceQuantity })
      .from(stockMovements)
      .where(and(eq(stockMovements.organizationId, auth.orgId), eq(stockMovements.itemId, itemId)))
      .orderBy(desc(stockMovements.createdAt), desc(sql`CASE WHEN split_part(${stockMovements.number}, '-', 3) ~ '^[0-9]+$' THEN split_part(${stockMovements.number}, '-', 3)::numeric ELSE 0 END`));
    const seen = new Set<string>();
    const byWh = new Map<string, number>();
    for (const m of sm) {
      if (seen.has(m.warehouseId)) continue;
      seen.add(m.warehouseId);
      byWh.set(m.warehouseId, Number(m.bal));
    }

    return { ok: true, stock: whs.map((w) => ({ warehouseId: w.id, name: w.name ?? "", qty: byWh.get(w.id) ?? 0 })) };
  });
}
