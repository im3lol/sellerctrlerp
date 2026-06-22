import "server-only";
import { and, asc, eq, gte, ilike, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { db } from "@/lib/db";
import {
  purchaseOrders, purchaseOrderLines, purchaseReceipts, purchaseReceiptLines,
  purchaseInvoices, purchaseInvoiceLines, purchaseReturns, purchaseReturnLines, suppliers, items,
} from "@/db/schema";

export type LedgerDocType = "ORDER" | "RECEIPT" | "INVOICE" | "RETURN";

export type LedgerRow = {
  id: string;
  number: string;
  date: Date;
  supplierName: string;
  docType: LedgerDocType;
  status: string;
  qtyTotal: number | null;
  qtyReceived: number | null;
  qtyRejected: number | null;
  subtotal: number | null;
  shipping: number | null;
  discount: number | null;
  tax: number | null;
  total: number | null;
  href: string;
};

export type LedgerTotals = {
  qtyTotal: number;
  qtyReceived: number;
  qtyRejected: number;
  subtotal: number;
  shipping: number;
  discount: number;
  tax: number;
  total: number;
};

export type LedgerFilters = {
  supplier?: string;
  type?: string; // "" | ORDER | RECEIPT | INVOICE | RETURN
  from?: string;
  to?: string;
  product?: string; // free-text: item code or name
};

const num = (v: string | null) => (v === null ? null : Number(v));

/** Distinct parent-document ids whose lines reference one of the given items. */
async function docIdsWithItem(
  table: PgTable,
  parentCol: PgColumn,
  itemCol: PgColumn,
  itemIds: string[],
): Promise<string[]> {
  if (!itemIds.length) return [];
  const r = await db.selectDistinct({ pid: parentCol }).from(table).where(inArray(itemCol, itemIds));
  return r.map((x) => x.pid as string);
}

/**
 * Consolidated purchases ledger: every purchase document (orders, receipts,
 * invoices, returns) as one row with quantity + money breakdown, filtered by
 * supplier / document type / date range. Org-scoped. Returns the FULL filtered
 * set (caller paginates) plus grand totals and the supplier list for filters.
 */
export async function getPurchasesLedger(orgId: string, filters: LedgerFilters) {
  const fromDate = filters.from ? new Date(filters.from) : null;
  const toDate = filters.to ? new Date(filters.to + "T23:59:59") : null;
  const fSupplier = filters.supplier ?? "";
  const fType = filters.type ?? "";
  const fProduct = (filters.product ?? "").trim();
  const want = (t: string) => !fType || fType === t;

  // Product filter → resolve matching item ids (by code or name). null = no filter.
  let matchedItemIds: string[] | null = null;
  if (fProduct) {
    const its = await db
      .select({ id: items.id })
      .from(items)
      .where(and(
        eq(items.organizationId, orgId),
        or(
          ilike(items.code, `%${fProduct}%`),
          ilike(items.nameAr, `%${fProduct}%`),
          ilike(items.nameEn, `%${fProduct}%`),
        ),
      ));
    matchedItemIds = its.map((i) => i.id);
  }

  const dateConds = (col: PgColumn) => {
    const c: SQL[] = [];
    if (fromDate) c.push(gte(col, fromDate));
    if (toDate) c.push(lte(col, toDate));
    return c;
  };

  const supList = await db
    .select({ id: suppliers.id, nameAr: suppliers.nameAr })
    .from(suppliers)
    .where(eq(suppliers.organizationId, orgId))
    .orderBy(asc(suppliers.code));
  const supMap = new Map(supList.map((s) => [s.id, s.nameAr]));

  const rows: LedgerRow[] = [];

  // ── Purchase Orders ──
  if (want("ORDER")) {
    const conds = [eq(purchaseOrders.organizationId, orgId), ...dateConds(purchaseOrders.date)];
    if (fSupplier) conds.push(eq(purchaseOrders.supplierId, fSupplier));
    if (matchedItemIds !== null) {
      const pids = await docIdsWithItem(purchaseOrderLines, purchaseOrderLines.purchaseOrderId, purchaseOrderLines.itemId, matchedItemIds);
      conds.push(pids.length ? inArray(purchaseOrders.id, pids) : sql`false`);
    }
    const list = await db
      .select({
        id: purchaseOrders.id, number: purchaseOrders.number, date: purchaseOrders.date,
        status: purchaseOrders.status, supplierId: purchaseOrders.supplierId,
        subtotal: purchaseOrders.subtotal, shipping: purchaseOrders.shippingAmount,
        discount: purchaseOrders.discountAmount, tax: purchaseOrders.taxAmount, total: purchaseOrders.totalAmount,
      })
      .from(purchaseOrders)
      .where(and(...conds));
    const ids = list.map((r) => r.id);
    const agg = ids.length
      ? await db.select({
          pid: purchaseOrderLines.purchaseOrderId,
          total: sql<string>`coalesce(sum(${purchaseOrderLines.quantity}),0)`,
          received: sql<string>`coalesce(sum(${purchaseOrderLines.receivedQty}),0)`,
        }).from(purchaseOrderLines)
          .where(inArray(purchaseOrderLines.purchaseOrderId, ids))
          .groupBy(purchaseOrderLines.purchaseOrderId)
      : [];
    const qm = new Map(agg.map((a) => [a.pid, a]));
    for (const r of list) {
      const q = qm.get(r.id);
      rows.push({
        id: `ORDER-${r.id}`, number: r.number, date: r.date,
        supplierName: supMap.get(r.supplierId) ?? "—", docType: "ORDER", status: r.status,
        qtyTotal: Number(q?.total ?? 0), qtyReceived: Number(q?.received ?? 0), qtyRejected: null,
        subtotal: num(r.subtotal), shipping: num(r.shipping), discount: num(r.discount),
        tax: num(r.tax), total: num(r.total), href: `/erp/purchases/orders/${r.number}`,
      });
    }
  }

  // ── Purchase Receipts (stock only — no money columns) ──
  if (want("RECEIPT")) {
    const conds = [eq(purchaseReceipts.organizationId, orgId), ...dateConds(purchaseReceipts.date)];
    if (fSupplier) conds.push(eq(purchaseReceipts.supplierId, fSupplier));
    if (matchedItemIds !== null) {
      const pids = await docIdsWithItem(purchaseReceiptLines, purchaseReceiptLines.purchaseReceiptId, purchaseReceiptLines.itemId, matchedItemIds);
      conds.push(pids.length ? inArray(purchaseReceipts.id, pids) : sql`false`);
    }
    const list = await db
      .select({
        id: purchaseReceipts.id, number: purchaseReceipts.number, date: purchaseReceipts.date,
        status: purchaseReceipts.status, supplierId: purchaseReceipts.supplierId,
      })
      .from(purchaseReceipts)
      .where(and(...conds));
    const ids = list.map((r) => r.id);
    const agg = ids.length
      ? await db.select({
          pid: purchaseReceiptLines.purchaseReceiptId,
          received: sql<string>`coalesce(sum(${purchaseReceiptLines.quantity}),0)`,
          rejected: sql<string>`coalesce(sum(${purchaseReceiptLines.rejectedQty}),0)`,
        }).from(purchaseReceiptLines)
          .where(inArray(purchaseReceiptLines.purchaseReceiptId, ids))
          .groupBy(purchaseReceiptLines.purchaseReceiptId)
      : [];
    const qm = new Map(agg.map((a) => [a.pid, a]));
    for (const r of list) {
      const q = qm.get(r.id);
      const recv = Number(q?.received ?? 0);
      const rej = Number(q?.rejected ?? 0);
      rows.push({
        id: `RECEIPT-${r.id}`, number: r.number, date: r.date,
        supplierName: (r.supplierId && supMap.get(r.supplierId)) || "—", docType: "RECEIPT", status: r.status,
        qtyTotal: recv + rej, qtyReceived: recv, qtyRejected: rej,
        subtotal: null, shipping: null, discount: null, tax: null, total: null,
        href: `/erp/purchases/receipts/${r.number}`,
      });
    }
  }

  // ── Purchase Invoices ──
  if (want("INVOICE")) {
    const conds = [eq(purchaseInvoices.organizationId, orgId), ...dateConds(purchaseInvoices.date)];
    if (fSupplier) conds.push(eq(purchaseInvoices.supplierId, fSupplier));
    if (matchedItemIds !== null) {
      const pids = await docIdsWithItem(purchaseInvoiceLines, purchaseInvoiceLines.purchaseInvoiceId, purchaseInvoiceLines.itemId, matchedItemIds);
      conds.push(pids.length ? inArray(purchaseInvoices.id, pids) : sql`false`);
    }
    const list = await db
      .select({
        id: purchaseInvoices.id, number: purchaseInvoices.number, date: purchaseInvoices.date,
        status: purchaseInvoices.status, supplierId: purchaseInvoices.supplierId,
        subtotal: purchaseInvoices.subtotal, shipping: purchaseInvoices.shippingAmount,
        discount: purchaseInvoices.discountAmount, tax: purchaseInvoices.taxAmount, total: purchaseInvoices.totalAmount,
      })
      .from(purchaseInvoices)
      .where(and(...conds));
    const ids = list.map((r) => r.id);
    const agg = ids.length
      ? await db.select({
          pid: purchaseInvoiceLines.purchaseInvoiceId,
          total: sql<string>`coalesce(sum(${purchaseInvoiceLines.quantity}),0)`,
        }).from(purchaseInvoiceLines)
          .where(inArray(purchaseInvoiceLines.purchaseInvoiceId, ids))
          .groupBy(purchaseInvoiceLines.purchaseInvoiceId)
      : [];
    const qm = new Map(agg.map((a) => [a.pid, a]));
    for (const r of list) {
      rows.push({
        id: `INVOICE-${r.id}`, number: r.number, date: r.date,
        supplierName: supMap.get(r.supplierId) ?? "—", docType: "INVOICE", status: r.status,
        qtyTotal: Number(qm.get(r.id)?.total ?? 0), qtyReceived: null, qtyRejected: null,
        subtotal: num(r.subtotal), shipping: num(r.shipping), discount: num(r.discount),
        tax: num(r.tax), total: num(r.total), href: `/erp/purchases/invoices/${r.number}`,
      });
    }
  }

  // ── Purchase Returns (debit notes — total only) ──
  if (want("RETURN")) {
    const conds = [eq(purchaseReturns.organizationId, orgId), ...dateConds(purchaseReturns.date)];
    if (fSupplier) conds.push(eq(purchaseReturns.supplierId, fSupplier));
    if (matchedItemIds !== null) {
      const pids = await docIdsWithItem(purchaseReturnLines, purchaseReturnLines.purchaseReturnId, purchaseReturnLines.itemId, matchedItemIds);
      conds.push(pids.length ? inArray(purchaseReturns.id, pids) : sql`false`);
    }
    const list = await db
      .select({
        id: purchaseReturns.id, number: purchaseReturns.number, date: purchaseReturns.date,
        status: purchaseReturns.status, supplierId: purchaseReturns.supplierId, total: purchaseReturns.totalAmount,
      })
      .from(purchaseReturns)
      .where(and(...conds));
    const ids = list.map((r) => r.id);
    const agg = ids.length
      ? await db.select({
          pid: purchaseReturnLines.purchaseReturnId,
          total: sql<string>`coalesce(sum(${purchaseReturnLines.quantity}),0)`,
        }).from(purchaseReturnLines)
          .where(inArray(purchaseReturnLines.purchaseReturnId, ids))
          .groupBy(purchaseReturnLines.purchaseReturnId)
      : [];
    const qm = new Map(agg.map((a) => [a.pid, a]));
    for (const r of list) {
      rows.push({
        id: `RETURN-${r.id}`, number: r.number, date: r.date,
        supplierName: supMap.get(r.supplierId) ?? "—", docType: "RETURN", status: r.status,
        qtyTotal: Number(qm.get(r.id)?.total ?? 0), qtyReceived: null, qtyRejected: null,
        subtotal: null, shipping: null, discount: null, tax: null, total: num(r.total),
        href: `/erp/purchases/returns/${r.number}`,
      });
    }
  }

  // Newest-first.
  rows.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const totals = rows.reduce(
    (acc, r) => {
      acc.qtyTotal += r.qtyTotal ?? 0;
      acc.qtyReceived += r.qtyReceived ?? 0;
      acc.qtyRejected += r.qtyRejected ?? 0;
      acc.subtotal += r.subtotal ?? 0;
      acc.shipping += r.shipping ?? 0;
      acc.discount += r.discount ?? 0;
      acc.tax += r.tax ?? 0;
      acc.total += r.total ?? 0;
      return acc;
    },
    { qtyTotal: 0, qtyReceived: 0, qtyRejected: 0, subtotal: 0, shipping: 0, discount: 0, tax: 0, total: 0 } as LedgerTotals,
  );

  return { rows, totals, suppliers: supList };
}
