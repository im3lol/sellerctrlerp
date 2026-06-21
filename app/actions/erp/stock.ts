"use server";

import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { warehouses, stockMovements } from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";

export type WarehouseStock = { warehouseId: string; name: string; qty: number };

/** Current on-hand quantity of an item in each active warehouse (0 where none). */
export async function getItemWarehouseStockAction(itemId: string): Promise<ActionState & { stock?: WarehouseStock[] }> {
  const auth = await authorizeErp("sales.view");
  if ("error" in auth) return auth;

  const whs = await db.select({ id: warehouses.id, name: warehouses.nameAr }).from(warehouses)
    .where(and(eq(warehouses.organizationId, auth.orgId), eq(warehouses.isActive, true))).orderBy(asc(warehouses.code));

  const sm = await db.select({ warehouseId: stockMovements.warehouseId, bal: stockMovements.balanceQuantity })
    .from(stockMovements)
    .where(and(eq(stockMovements.organizationId, auth.orgId), eq(stockMovements.itemId, itemId)))
    .orderBy(desc(stockMovements.createdAt), desc(stockMovements.id));
  const seen = new Set<string>();
  const byWh = new Map<string, number>();
  for (const m of sm) {
    if (seen.has(m.warehouseId)) continue;
    seen.add(m.warehouseId);
    byWh.set(m.warehouseId, Number(m.bal));
  }

  return { ok: true, stock: whs.map((w) => ({ warehouseId: w.id, name: w.name ?? "", qty: byWh.get(w.id) ?? 0 })) };
}
