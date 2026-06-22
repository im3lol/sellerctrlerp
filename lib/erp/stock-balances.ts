import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { warehouses } from "@/db/schema";

export type StockStatus = "OUT" | "LOW" | "OK";

export type StockBalanceLine = {
  itemId: string;
  code: string;
  name: string;
  warehouse: string;
  warehouseId: string;
  min: number;
  quantity: number;
  value: number;
  avgCost: number;
  status: StockStatus;
  nearestExpiry: Date | null;
  expiryStatus: "EXPIRED" | "NEAR" | "OK" | null;
};

export type StockBalanceTotals = { value: number; quantity: number; items: number; low: number; out: number };

export type StockBalanceFilters = {
  product?: string; // free-text: item code or name
  warehouse?: string; // warehouse id
  status?: string; // "" | OUT | LOW | OK
};

type Raw = {
  item_id: string;
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
      sm.item_id AS item_id,
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
      itemId: r.item_id,
      code: r.item_code,
      name: r.item_name,
      warehouse: r.warehouse_name,
      warehouseId: r.warehouse_id,
      min,
      quantity,
      value,
      avgCost: quantity > 0 ? value / quantity : 0,
      status,
      nearestExpiry: null as Date | null,
      expiryStatus: null as StockBalanceLine["expiryStatus"],
    };
  });

  // Keep only non-empty balances (matches the prior page behaviour).
  lines = lines.filter((l) => Math.abs(l.quantity) > 1e-9 || Math.abs(l.value) > 1e-9);

  // Nearest expiry per (item, warehouse) from live batches (perishables only).
  const exp = await db.execute<{ item_id: string; warehouse_id: string; nearest: string }>(sql`
    SELECT item_id, warehouse_id, min(expiry_date) AS nearest FROM stock_batches
    WHERE organization_id = ${orgId} AND remaining_quantity > 0 AND expiry_date IS NOT NULL
    GROUP BY item_id, warehouse_id`);
  const expMap = new Map((exp.rows ?? []).map((r) => [`${r.item_id}|${r.warehouse_id}`, r.nearest]));
  const now = Date.now();
  for (const l of lines) {
    const n = expMap.get(`${l.itemId}|${l.warehouseId}`);
    if (!n) continue;
    const d = new Date(n);
    l.nearestExpiry = d;
    const daysLeft = Math.floor((d.getTime() - now) / 86400000);
    l.expiryStatus = daysLeft < 0 ? "EXPIRED" : daysLeft <= 30 ? "NEAR" : "OK";
  }

  // Product suggestions from the full balance set (before the product filter narrows it).
  const productSuggestions = Array.from(
    new Map(lines.map((l) => [l.code, { value: l.name, hint: l.code }])).values(),
  );

  if (fProduct) lines = lines.filter((l) => l.code.toLowerCase().includes(fProduct) || l.name.toLowerCase().includes(fProduct));
  if (fWarehouse) lines = lines.filter((l) => l.warehouseId === fWarehouse);
  if (fStatus) lines = lines.filter((l) => l.status === fStatus);

  lines.sort((a, b) => a.code.localeCompare(b.code) || a.warehouse.localeCompare(b.warehouse));

  const itemCodes = new Set<string>();
  const totals = lines.reduce(
    (acc, l) => {
      acc.value += l.value;
      acc.quantity += l.quantity;
      itemCodes.add(l.code);
      if (l.status === "LOW") acc.low += 1;
      if (l.status === "OUT") acc.out += 1;
      return acc;
    },
    { value: 0, quantity: 0, items: 0, low: 0, out: 0 } as StockBalanceTotals,
  );
  totals.items = itemCodes.size;

  return { lines, totals, warehouses: whList, productSuggestions };
}
