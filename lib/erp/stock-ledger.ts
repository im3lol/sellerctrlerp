import "server-only";
import { and, asc, count, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { items, warehouses, stockMovements, deliveryNotes, purchaseReceipts, purchaseInvoices, salesInvoices, purchaseReturns, salesReturns, stockAdjustments, stockTransfers } from "@/db/schema";

export const MOVE_TYPE: Record<string, { label: string; tone: "in" | "out" | "adj" }> = {
  IN: { label: "وارد", tone: "in" },
  OUT: { label: "منصرف", tone: "out" },
  ADJ: { label: "تسوية", tone: "adj" },
};

export const MOVE_REF: Record<string, string> = {
  OPENING_STOCK: "رصيد افتتاحي",
  OPENING_BALANCE: "رصيد افتتاحي",
  ASSEMBLY: "تجميع حزمة",
  DISASSEMBLY: "فك حزمة",
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
  refNumber: string | null; // the source document's own number (e.g. GR-2026-0001)
  refHref: string | null;   // clickable path to that document's detail page
  reason: string | null;
  itemId: string | null;
  itemCode: string | null;
  itemName: string | null;
  warehouse: string | null;
  quantity: number;
  unitCost: number;
  balanceQuantity: number;
  balanceValue: number;
};

export type StockLedgerTotals = { inQty: number; outQty: number; adjNet: number; net: number };

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
    db.select({ id: items.id, code: items.code, nameAr: items.nameAr })
      .from(items)
      .where(and(eq(items.organizationId, orgId), eq(items.isActive, true)))
      .orderBy(asc(items.code)),
    db.select({ id: warehouses.id, code: warehouses.code, nameAr: warehouses.nameAr })
      .from(warehouses)
      .where(and(eq(warehouses.organizationId, orgId), eq(warehouses.isActive, true)))
      .orderBy(asc(warehouses.code)),
  ]);

  const it = itemId ? itemList.find((i) => i.id === itemId) : undefined;
  const itemLabel = it ? `${it.code} — ${it.nameAr ?? ""}` : "";

  const conds: SQL[] = [eq(stockMovements.organizationId, orgId)];
  if (itemId) conds.push(eq(stockMovements.itemId, itemId));
  if (fWarehouse) conds.push(eq(stockMovements.warehouseId, fWarehouse));
  if (fType) conds.push(eq(stockMovements.type, fType));
  if (fromDate) conds.push(gte(stockMovements.date, fromDate));
  if (toDate) conds.push(lte(stockMovements.date, toDate));
  const where = and(...conds);

  // Totals over the full filtered set. ADJ rows store |quantity| with no sign —
  // an adjustment DECREASE would otherwise count as inbound — so their signed
  // net is recovered from the running-balance delta (lag over the item+warehouse
  // partition). The partition filters (org/item/warehouse) go INSIDE the window
  // subquery; date/type filters go OUTSIDE so they can't break lag pairs.
  const innerConds: SQL[] = [sql`organization_id = ${orgId}`];
  if (itemId) innerConds.push(sql`item_id = ${itemId}`);
  if (fWarehouse) innerConds.push(sql`warehouse_id = ${fWarehouse}`);
  const outerConds: SQL[] = [sql`true`];
  if (fType) outerConds.push(sql`type = ${fType}`);
  if (fromDate) outerConds.push(sql`date >= ${fromDate}`);
  if (toDate) outerConds.push(sql`date <= ${toDate}`);
  const totalsRes = await db.execute<{ in_qty: string; out_qty: string; adj_net: string }>(sql`
    SELECT
      coalesce(sum(quantity) FILTER (WHERE type = 'IN'), 0)  AS in_qty,
      coalesce(sum(quantity) FILTER (WHERE type = 'OUT'), 0) AS out_qty,
      coalesce(sum(delta)    FILTER (WHERE type = 'ADJ'), 0) AS adj_net
    FROM (
      SELECT type, date, quantity,
        balance_quantity - lag(balance_quantity, 1, 0::numeric)
          OVER (PARTITION BY item_id, warehouse_id ORDER BY created_at, split_part(number, '-', 3)::int) AS delta
      FROM stock_movements
      WHERE ${sql.join(innerConds, sql` AND `)}
    ) t
    WHERE ${sql.join(outerConds, sql` AND `)}`);
  const tr = totalsRes.rows[0];
  const totals: StockLedgerTotals = {
    inQty: Number(tr?.in_qty ?? 0),
    outQty: Number(tr?.out_qty ?? 0),
    adjNet: Number(tr?.adj_net ?? 0),
    net: 0,
  };
  totals.net = totals.inQty - totals.outQty + totals.adjNet;

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
      refId: stockMovements.referenceId,
      reason: stockMovements.reason,
      itemId: stockMovements.itemId,
      itemCode: items.code,
      itemName: sql<string>`coalesce(${items.nameAr}, ${items.code})`,
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

  // Resolve each movement's source DOCUMENT (number + link) for the page's rows.
  // refType family → (table, detail route). Adjustments/transfers route by id;
  // the rest route by the document number.
  const DOC_SOURCES = [
    { types: ["DELIVERY", "DELIVERY_REVERSE"], table: deliveryNotes, href: (r: { id: string; number: string }) => `/sales/deliveries/${encodeURIComponent(r.number)}` },
    { types: ["GOODS_RECEIPT", "GOODS_RECEIPT_REVERSE"], table: purchaseReceipts, href: (r: { id: string; number: string }) => `/purchases/receipts/${encodeURIComponent(r.number)}` },
    { types: ["PURCHASE_INVOICE"], table: purchaseInvoices, href: (r: { id: string; number: string }) => `/purchases/invoices/${encodeURIComponent(r.number)}` },
    { types: ["SALES_INVOICE"], table: salesInvoices, href: (r: { id: string; number: string }) => `/sales/invoices/${encodeURIComponent(r.number)}` },
    { types: ["PURCHASE_RETURN", "PURCHASE_RETURN_CANCEL"], table: purchaseReturns, href: (r: { id: string; number: string }) => `/purchases/returns/${encodeURIComponent(r.number)}` },
    { types: ["SALES_RETURN", "SALES_RETURN_CANCEL"], table: salesReturns, href: (r: { id: string; number: string }) => `/sales/returns/${encodeURIComponent(r.number)}` },
    { types: ["ADJUSTMENT"], table: stockAdjustments, href: (r: { id: string; number: string }) => `/inventory/adjustments/${r.id}` },
    { types: ["TRANSFER"], table: stockTransfers, href: (r: { id: string; number: string }) => `/inventory/transfers/${r.id}` },
  ] as const;
  const docBy = new Map<string, { number: string; href: string }>();
  await Promise.all(DOC_SOURCES.map(async (src) => {
    const ids = [...new Set(raw.filter((r) => r.refId && (src.types as readonly string[]).includes(r.refType ?? "")).map((r) => r.refId as string))];
    if (!ids.length) return;
    const t = src.table;
    const docs = await db.select({ id: t.id, number: t.number }).from(t)
      .where(and(eq(t.organizationId, orgId), sql`${t.id} in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`));
    for (const d of docs) docBy.set(d.id, { number: d.number, href: src.href(d) });
  }));

  const rows: StockLedgerRow[] = raw.map((r) => {
    const doc = r.refId ? docBy.get(r.refId) : undefined;
    return {
      ...r,
      refNumber: doc?.number ?? null,
      refHref: doc?.href ?? null,
      quantity: Number(r.quantity),
      unitCost: Number(r.unitCost),
      balanceQuantity: Number(r.balanceQuantity),
      balanceValue: Number(r.balanceValue),
    };
  });

  return { rows, totals, totalRows, itemLabel, items: itemList, warehouses: whList };
}
