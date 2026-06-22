import "server-only";
import { and, asc, eq, gte, lte, type SQL } from "drizzle-orm";
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
};

/** Per-item stock movement ledger (WAC running balance), with filters. */
export async function getStockLedger(orgId: string, filters: StockLedgerFilters) {
  const itemId = filters.itemId ?? "";
  const fWarehouse = filters.warehouse ?? "";
  const fType = filters.type ?? "";
  const fromDate = filters.from ? new Date(filters.from) : null;
  const toDate = filters.to ? new Date(filters.to + "T23:59:59") : null;

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

  let rows: StockLedgerRow[] = [];
  let itemLabel = "";
  if (itemId) {
    const it = itemList.find((i) => i.id === itemId);
    itemLabel = it ? `${it.code} — ${it.nameAr ?? it.nameEn ?? ""}` : "";

    const conds: SQL[] = [eq(stockMovements.organizationId, orgId), eq(stockMovements.itemId, itemId)];
    if (fWarehouse) conds.push(eq(stockMovements.warehouseId, fWarehouse));
    if (fType) conds.push(eq(stockMovements.type, fType));
    if (fromDate) conds.push(gte(stockMovements.date, fromDate));
    if (toDate) conds.push(lte(stockMovements.date, toDate));

    const raw = await db
      .select({
        date: stockMovements.date,
        number: stockMovements.number,
        type: stockMovements.type,
        refType: stockMovements.referenceType,
        reason: stockMovements.reason,
        warehouse: warehouses.nameAr,
        quantity: stockMovements.quantity,
        unitCost: stockMovements.unitCost,
        balanceQuantity: stockMovements.balanceQuantity,
        balanceValue: stockMovements.balanceValue,
      })
      .from(stockMovements)
      .leftJoin(warehouses, eq(warehouses.id, stockMovements.warehouseId))
      .where(and(...conds))
      .orderBy(asc(stockMovements.date), asc(stockMovements.createdAt));

    rows = raw.map((r) => ({
      ...r,
      quantity: Number(r.quantity),
      unitCost: Number(r.unitCost),
      balanceQuantity: Number(r.balanceQuantity),
      balanceValue: Number(r.balanceValue),
    }));
  }

  const totals = rows.reduce(
    (acc, r) => {
      if (r.type === "OUT") acc.outQty += r.quantity;
      else acc.inQty += r.quantity;
      return acc;
    },
    { inQty: 0, outQty: 0, net: 0 } as StockLedgerTotals,
  );
  totals.net = totals.inQty - totals.outQty;

  return { rows, totals, itemLabel, items: itemList, warehouses: whList };
}
