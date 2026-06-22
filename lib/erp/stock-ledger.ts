import "server-only";
import { and, asc, count, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { items, warehouses, stockMovements } from "@/db/schema";

export const MOVE_TYPE: Record<string, { label: string; tone: "in" | "out" | "adj" }> = {
  IN: { label: "وارد", tone: "in" },
  OUT: { label: "منصرف", tone: "out" },
  ADJ: { label: "تسوية", tone: "adj" },
};

export const MOVE_REF: Record<string, string> = {
  OPENING_STOCK: "رصيد افتتاحي",
  GOODS_RECEIPT: "إذن استلام",
  GOODS_RECEIPT_REVERSE: "عكس إذن استلام",
  DELIVERY: "إذن صرف",
  DELIVERY_REVERSE: "عكس إذن صرف",
  PURCHASE_INVOICE: "فاتورة شراء",
  SALES_INVOICE: "فاتورة بيع",
  PURCHASE_RETURN: "مرتجع شراء",
  PURCHASE_RETURN_CANCEL: "إلغاء مرتجع شراء",
  SALES_RETURN: "مرتجع بيع",
  SALES_RETURN_CANCEL: "إلغاء مرتجع بيع",
  ADJUSTMENT: "تسوية مخزون",
  TRANSFER: "تحويل مخزني",
};

export type StockLedgerRow = {
  date: Date;
  number: string;
  type: string;
  refType: string | null;
  reason: string | null;
  itemCode: string | null;
  itemName: string | null;
  warehouse: string | null;
  quantity: number;
  unitCost: number;
  balanceQuantity: number;
  balanceValue: number;
};

export type StockLedgerTotals = { inQty: number; outQty: number; net: number };

export type StockLedgerFilters = {
  itemId?: string;
  warehouse?: string;
  from?: string;
  to?: string;
  type?: string; // "" | IN | OUT | ADJ
  page?: number; // 1-based; omit to return all rows (export)
  pageSize?: number;
};

/**
 * Stock movement ledger. With no itemId it shows the latest movements across all
 * items (newest first); with an itemId it shows that item's full history oldest
 * first (so the WAC running balance reads correctly). Totals + count cover the
 * whole filtered set; rows are paginated when pageSize is given.
 */
export async function getStockLedger(orgId: string, filters: StockLedgerFilters) {
  const itemId = filters.itemId ?? "";
  const fWarehouse = filters.warehouse ?? "";
  const fType = filters.type ?? "";
  const fromDate = filters.from ? new Date(filters.from) : null;
  const toDate = filters.to ? new Date(filters.to + "T23:59:59") : null;
  const pageSize = filters.pageSize;
  const page = Math.max(1, filters.page ?? 1);

  const [itemList, whList] = await Promise.all([
    db.select({ id: items.id, code: items.code, nameAr: items.nameAr, nameEn: items.nameEn })
      .from(items)
      .where(and(eq(items.organizationId, orgId), eq(items.isActive, true)))
      .orderBy(asc(items.code)),
    db.select({ id: warehouses.id, code: warehouses.code, nameAr: warehouses.nameAr })
      .from(warehouses)
      .where(and(eq(warehouses.organizationId, orgId), eq(warehouses.isActive, true)))
      .orderBy(asc(warehouses.code)),
  ]);

  const it = itemId ? itemList.find((i) => i.id === itemId) : undefined;
  const itemLabel = it ? `${it.code} — ${it.nameAr ?? it.nameEn ?? ""}` : "";

  const conds: SQL[] = [eq(stockMovements.organizationId, orgId)];
  if (itemId) conds.push(eq(stockMovements.itemId, itemId));
  if (fWarehouse) conds.push(eq(stockMovements.warehouseId, fWarehouse));
  if (fType) conds.push(eq(stockMovements.type, fType));
  if (fromDate) conds.push(gte(stockMovements.date, fromDate));
  if (toDate) conds.push(lte(stockMovements.date, toDate));
  const where = and(...conds);

  // Totals over the full filtered set.
  const totalsRows = await db
    .select({ type: stockMovements.type, q: sql<string>`coalesce(sum(${stockMovements.quantity}),0)` })
    .from(stockMovements)
    .where(where)
    .groupBy(stockMovements.type);
  const totals: StockLedgerTotals = { inQty: 0, outQty: 0, net: 0 };
  for (const t of totalsRows) {
    if (t.type === "OUT") totals.outQty += Number(t.q);
    else totals.inQty += Number(t.q);
  }
  totals.net = totals.inQty - totals.outQty;

  let totalRows = 0;
  if (pageSize) {
    const [{ c }] = await db.select({ c: count() }).from(stockMovements).where(where);
    totalRows = Number(c);
  }

  const base = db
    .select({
      date: stockMovements.date,
      number: stockMovements.number,
      type: stockMovements.type,
      refType: stockMovements.referenceType,
      reason: stockMovements.reason,
      itemCode: items.code,
      itemName: sql<string>`coalesce(${items.nameAr}, ${items.nameEn}, ${items.code})`,
      warehouse: warehouses.nameAr,
      quantity: stockMovements.quantity,
      unitCost: stockMovements.unitCost,
      balanceQuantity: stockMovements.balanceQuantity,
      balanceValue: stockMovements.balanceValue,
    })
    .from(stockMovements)
    .leftJoin(items, eq(items.id, stockMovements.itemId))
    .leftJoin(warehouses, eq(warehouses.id, stockMovements.warehouseId))
    .where(where);

  const ordered = itemId
    ? base.orderBy(asc(stockMovements.date), asc(stockMovements.createdAt))
    : base.orderBy(desc(stockMovements.date), desc(stockMovements.createdAt));
  const raw = pageSize ? await ordered.limit(pageSize).offset((page - 1) * pageSize) : await ordered;

  const rows: StockLedgerRow[] = raw.map((r) => ({
    ...r,
    quantity: Number(r.quantity),
    unitCost: Number(r.unitCost),
    balanceQuantity: Number(r.balanceQuantity),
    balanceValue: Number(r.balanceValue),
  }));

  return { rows, totals, totalRows, itemLabel, items: itemList, warehouses: whList };
}
