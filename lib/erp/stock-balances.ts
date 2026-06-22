import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { warehouses } from "@/db/schema";

export type StockStatus = "OUT" | "LOW" | "OK";

export type StockBalanceLine = {
  code: string;
  name: string;
  warehouse: string;
  warehouseId: string;
  min: number;
  quantity: number;
  value: number;
  avgCost: number;
  status: StockStatus;
};

export type StockBalanceTotals = { value: number; count: number; low: number; out: number };

export type StockBalanceFilters = {
  product?: string; // free-text: item code or name
  warehouse?: string; // warehouse id
  status?: string; // "" | OUT | LOW | OK
};

type Raw = {
  item_code: string;
  item_name: string;
  warehouse_id: string;
  warehouse_name: string;
  min_stock: string;
  balance_quantity: string;
  balance_value: string;
};

/** Current stock balance per item+warehouse (perpetual ledger), with filters. */
export async function getStockBalances(orgId: string, filters: StockBalanceFilters) {
  const fProduct = (filters.product ?? "").trim().toLowerCase();
  const fWarehouse = filters.warehouse ?? "";
  const fStatus = filters.status ?? "";

  const whList = await db
    .select({ id: warehouses.id, code: warehouses.code, nameAr: warehouses.nameAr })
    .from(warehouses)
    .where(and(eq(warehouses.organizationId, orgId), eq(warehouses.isActive, true)))
    .orderBy(asc(warehouses.code));

  const result = await db.execute<Raw>(sql`
    SELECT DISTINCT ON (sm.item_id, sm.warehouse_id)
      i.code AS item_code,
      coalesce(i.name_ar, i.name_en, i.code) AS item_name,
      sm.warehouse_id AS warehouse_id,
      coalesce(w.name_ar, w.name_en, w.code) AS warehouse_name,
      coalesce(i.min_stock, 0) AS min_stock,
      sm.balance_quantity,
      sm.balance_value
    FROM stock_movements sm
    JOIN items i ON i.id = sm.item_id
    JOIN warehouses w ON w.id = sm.warehouse_id
    WHERE sm.organization_id = ${orgId}
    ORDER BY sm.item_id, sm.warehouse_id, sm.created_at DESC, sm.id DESC
  `);

  let lines: StockBalanceLine[] = (result.rows ?? []).map((r) => {
    const quantity = Number(r.balance_quantity);
    const value = Number(r.balance_value);
    const min = Number(r.min_stock);
    const status: StockStatus = quantity <= 0 ? "OUT" : min > 0 && quantity <= min ? "LOW" : "OK";
    return {
      code: r.item_code,
      name: r.item_name,
      warehouse: r.warehouse_name,
      warehouseId: r.warehouse_id,
      min,
      quantity,
      value,
      avgCost: quantity > 0 ? value / quantity : 0,
      status,
    };
  });

  // Keep only non-empty balances (matches the prior page behaviour).
  lines = lines.filter((l) => Math.abs(l.quantity) > 1e-9 || Math.abs(l.value) > 1e-9);

  // Product suggestions from the full balance set (before the product filter narrows it).
  const productSuggestions = Array.from(
    new Map(lines.map((l) => [l.code, { value: l.name, hint: l.code }])).values(),
  );

  if (fProduct) lines = lines.filter((l) => l.code.toLowerCase().includes(fProduct) || l.name.toLowerCase().includes(fProduct));
  if (fWarehouse) lines = lines.filter((l) => l.warehouseId === fWarehouse);
  if (fStatus) lines = lines.filter((l) => l.status === fStatus);

  lines.sort((a, b) => a.code.localeCompare(b.code) || a.warehouse.localeCompare(b.warehouse));

  const totals = lines.reduce(
    (acc, l) => {
      acc.value += l.value;
      acc.count += 1;
      if (l.status === "LOW") acc.low += 1;
      if (l.status === "OUT") acc.out += 1;
      return acc;
    },
    { value: 0, count: 0, low: 0, out: 0 } as StockBalanceTotals,
  );

  return { lines, totals, warehouses: whList, productSuggestions };
}
