import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { stockBatches, items, warehouses } from "@/db/schema";

export type ExpiryStatus = "EXPIRED" | "NEAR" | "OK";

export type ExpiryRow = {
  id: string;
  itemCode: string;
  itemName: string;
  warehouse: string;
  warehouseId: string;
  batchNo: string | null;
  expiryDate: Date;
  daysLeft: number;
  remaining: number;
  unitCost: number;
  value: number;
  status: ExpiryStatus;
};

export type ExpiryTotals = { expiredCount: number; expiredValue: number; nearCount: number; nearValue: number; okCount: number };

export type ExpiryFilters = { product?: string; warehouse?: string; status?: string; withinDays?: number };

const DAY = 86400000;

/** Batches with an expiry date and remaining stock, classified expired / near /
 *  ok against a near-expiry threshold (days). Org-scoped. */
export async function getExpiryReport(orgId: string, filters: ExpiryFilters) {
  const fProduct = (filters.product ?? "").trim().toLowerCase();
  const fWarehouse = filters.warehouse ?? "";
  const fStatus = filters.status ?? "";
  const withinDays = filters.withinDays && filters.withinDays > 0 ? filters.withinDays : 30;

  const whList = await db
    .select({ id: warehouses.id, code: warehouses.code, nameAr: warehouses.nameAr })
    .from(warehouses)
    .where(and(eq(warehouses.organizationId, orgId), eq(warehouses.isActive, true)))
    .orderBy(asc(warehouses.code));

  const raw = await db
    .select({
      id: stockBatches.id,
      itemCode: items.code,
      itemName: sql<string>`coalesce(${items.nameAr}, ${items.nameEn}, ${items.code})`,
      warehouse: warehouses.nameAr,
      warehouseId: stockBatches.warehouseId,
      batchNo: stockBatches.batchNo,
      expiryDate: stockBatches.expiryDate,
      remaining: stockBatches.remainingQuantity,
      unitCost: stockBatches.unitCost,
    })
    .from(stockBatches)
    .leftJoin(items, eq(items.id, stockBatches.itemId))
    .leftJoin(warehouses, eq(warehouses.id, stockBatches.warehouseId))
    .where(and(
      eq(stockBatches.organizationId, orgId),
      sql`${stockBatches.expiryDate} is not null`,
      sql`${stockBatches.remainingQuantity} > 0`,
    ))
    .orderBy(asc(stockBatches.expiryDate));

  const now = Date.now();
  let rows: ExpiryRow[] = raw.map((r) => {
    const expiryDate = new Date(r.expiryDate as unknown as string);
    const daysLeft = Math.floor((expiryDate.getTime() - now) / DAY);
    const remaining = Number(r.remaining);
    const unitCost = Number(r.unitCost);
    const status: ExpiryStatus = daysLeft < 0 ? "EXPIRED" : daysLeft <= withinDays ? "NEAR" : "OK";
    return {
      id: r.id, itemCode: r.itemCode ?? "", itemName: r.itemName ?? "", warehouse: r.warehouse ?? "—",
      warehouseId: r.warehouseId, batchNo: r.batchNo, expiryDate, daysLeft, remaining, unitCost,
      value: Math.round(remaining * unitCost * 100) / 100, status,
    };
  });

  const productSuggestions = Array.from(
    new Map(rows.map((r) => [r.itemCode, { value: r.itemName, hint: r.itemCode }])).values(),
  );

  if (fProduct) rows = rows.filter((r) => r.itemCode.toLowerCase().includes(fProduct) || r.itemName.toLowerCase().includes(fProduct));
  if (fWarehouse) rows = rows.filter((r) => r.warehouseId === fWarehouse);
  if (fStatus) rows = rows.filter((r) => r.status === fStatus);

  const totals = rows.reduce(
    (acc, r) => {
      if (r.status === "EXPIRED") { acc.expiredCount += 1; acc.expiredValue += r.value; }
      else if (r.status === "NEAR") { acc.nearCount += 1; acc.nearValue += r.value; }
      else acc.okCount += 1;
      return acc;
    },
    { expiredCount: 0, expiredValue: 0, nearCount: 0, nearValue: 0, okCount: 0 } as ExpiryTotals,
  );

  return { rows, totals, warehouses: whList, productSuggestions, withinDays };
}
