import "server-only";
import { and, asc, eq, gte, ilike, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { db } from "@/lib/db";
import {
  salesOrders, salesOrderLines, deliveryNotes, deliveryNoteLines,
  salesInvoices, salesInvoiceLines, salesReturns, salesReturnLines, customers, items,
} from "@/db/schema";

export type SalesLedgerDocType = "ORDER" | "DELIVERY" | "INVOICE" | "RETURN";

export type SalesLedgerRow = {
  id: string;
  number: string;
  date: Date;
  customerName: string;
  docType: SalesLedgerDocType;
  status: string;
  qtyTotal: number | null;
  qtyDelivered: number | null;
  subtotal: number | null;
  discount: number | null;
  tax: number | null;
  total: number | null;
  href: string;
};

export type SalesLedgerTotals = {
  qtyTotal: number;
  qtyDelivered: number;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
};

export type SalesLedgerFilters = {
  customer?: string;
  type?: string; // "" | ORDER | DELIVERY | INVOICE | RETURN
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
 * Consolidated sales ledger: every sales document (orders, deliveries, invoices,
 * returns) as one row with quantity + money breakdown, filtered by customer /
 * document type / date range / product. Org-scoped. Returns the FULL filtered set.
 */
export async function getSalesLedger(orgId: string, filters: SalesLedgerFilters) {
  const fromDate = filters.from ? new Date(filters.from) : null;
  const toDate = filters.to ? new Date(filters.to + "T23:59:59") : null;
  const fCustomer = (filters.customer ?? "").trim();
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

  const custList = await db
    .select({ id: customers.id, code: customers.code, nameAr: customers.nameAr, nameEn: customers.nameEn })
    .from(customers)
    .where(eq(customers.organizationId, orgId))
    .orderBy(asc(customers.code));
  const custMap = new Map(custList.map((c) => [c.id, c.nameAr]));

  // Suggestion list for the product search box (active items).
  const itemList = await db
    .select({ id: items.id, code: items.code, nameAr: items.nameAr })
    .from(items)
    .where(and(eq(items.organizationId, orgId), eq(items.isActive, true)))
    .orderBy(asc(items.code))
    .limit(1000);

  // Customer filter → free-text match on code or name (in-memory; bounded list). null = no filter.
  let matchedCustomerIds: string[] | null = null;
  if (fCustomer) {
    const q = fCustomer.toLowerCase();
    matchedCustomerIds = custList
      .filter((c) =>
        (c.code ?? "").toLowerCase().includes(q) ||
        (c.nameAr ?? "").toLowerCase().includes(q) ||
        (c.nameEn ?? "").toLowerCase().includes(q),
      )
      .map((c) => c.id);
  }

  const rows: SalesLedgerRow[] = [];

  // ── Sales Orders ──
  if (want("ORDER")) {
    const conds = [eq(salesOrders.organizationId, orgId), ...dateConds(salesOrders.date)];
    if (matchedCustomerIds !== null) conds.push(matchedCustomerIds.length ? inArray(salesOrders.customerId, matchedCustomerIds) : sql`false`);
    if (matchedItemIds !== null) {
      const pids = await docIdsWithItem(salesOrderLines, salesOrderLines.salesOrderId, salesOrderLines.itemId, matchedItemIds);
      conds.push(pids.length ? inArray(salesOrders.id, pids) : sql`false`);
    }
    const list = await db
      .select({
        id: salesOrders.id, number: salesOrders.number, date: salesOrders.date,
        status: salesOrders.status, customerId: salesOrders.customerId,
        subtotal: salesOrders.subtotal, discount: salesOrders.discountAmount,
        tax: salesOrders.taxAmount, total: salesOrders.totalAmount,
      })
      .from(salesOrders)
      .where(and(...conds));
    const ids = list.map((r) => r.id);
    const agg = ids.length
      ? await db.select({
          pid: salesOrderLines.salesOrderId,
          total: sql<string>`coalesce(sum(${salesOrderLines.quantity}),0)`,
          delivered: sql<string>`coalesce(sum(${salesOrderLines.deliveredQty}),0)`,
        }).from(salesOrderLines)
          .where(inArray(salesOrderLines.salesOrderId, ids))
          .groupBy(salesOrderLines.salesOrderId)
      : [];
    const qm = new Map(agg.map((a) => [a.pid, a]));
    for (const r of list) {
      const q = qm.get(r.id);
      rows.push({
        id: `ORDER-${r.id}`, number: r.number, date: r.date,
        customerName: custMap.get(r.customerId) ?? "—", docType: "ORDER", status: r.status,
        qtyTotal: Number(q?.total ?? 0), qtyDelivered: Number(q?.delivered ?? 0),
        subtotal: num(r.subtotal), discount: num(r.discount), tax: num(r.tax), total: num(r.total),
        href: `/erp/sales/orders/${r.number}`,
      });
    }
  }

  // ── Deliveries (إذن صرف — stock only, no money) ──
  if (want("DELIVERY")) {
    const conds = [eq(deliveryNotes.organizationId, orgId), ...dateConds(deliveryNotes.date)];
    if (matchedCustomerIds !== null) conds.push(matchedCustomerIds.length ? inArray(deliveryNotes.customerId, matchedCustomerIds) : sql`false`);
    if (matchedItemIds !== null) {
      const pids = await docIdsWithItem(deliveryNoteLines, deliveryNoteLines.deliveryNoteId, deliveryNoteLines.itemId, matchedItemIds);
      conds.push(pids.length ? inArray(deliveryNotes.id, pids) : sql`false`);
    }
    const list = await db
      .select({
        id: deliveryNotes.id, number: deliveryNotes.number, date: deliveryNotes.date,
        status: deliveryNotes.status, customerId: deliveryNotes.customerId,
      })
      .from(deliveryNotes)
      .where(and(...conds));
    const ids = list.map((r) => r.id);
    const agg = ids.length
      ? await db.select({
          pid: deliveryNoteLines.deliveryNoteId,
          total: sql<string>`coalesce(sum(${deliveryNoteLines.quantity}),0)`,
        }).from(deliveryNoteLines)
          .where(inArray(deliveryNoteLines.deliveryNoteId, ids))
          .groupBy(deliveryNoteLines.deliveryNoteId)
      : [];
    const qm = new Map(agg.map((a) => [a.pid, a]));
    for (const r of list) {
      rows.push({
        id: `DELIVERY-${r.id}`, number: r.number, date: r.date,
        customerName: (r.customerId && custMap.get(r.customerId)) || "—", docType: "DELIVERY", status: r.status,
        qtyTotal: Number(qm.get(r.id)?.total ?? 0), qtyDelivered: null,
        subtotal: null, discount: null, tax: null, total: null,
        href: `/erp/sales/deliveries/${r.number}`,
      });
    }
  }

  // ── Sales Invoices ──
  if (want("INVOICE")) {
    const conds = [eq(salesInvoices.organizationId, orgId), ...dateConds(salesInvoices.date)];
    if (matchedCustomerIds !== null) conds.push(matchedCustomerIds.length ? inArray(salesInvoices.customerId, matchedCustomerIds) : sql`false`);
    if (matchedItemIds !== null) {
      const pids = await docIdsWithItem(salesInvoiceLines, salesInvoiceLines.salesInvoiceId, salesInvoiceLines.itemId, matchedItemIds);
      conds.push(pids.length ? inArray(salesInvoices.id, pids) : sql`false`);
    }
    const list = await db
      .select({
        id: salesInvoices.id, number: salesInvoices.number, date: salesInvoices.date,
        status: salesInvoices.status, customerId: salesInvoices.customerId,
        subtotal: salesInvoices.subtotal, discount: salesInvoices.discountAmount,
        tax: salesInvoices.taxAmount, total: salesInvoices.totalAmount,
      })
      .from(salesInvoices)
      .where(and(...conds));
    const ids = list.map((r) => r.id);
    const agg = ids.length
      ? await db.select({
          pid: salesInvoiceLines.salesInvoiceId,
          total: sql<string>`coalesce(sum(${salesInvoiceLines.quantity}),0)`,
        }).from(salesInvoiceLines)
          .where(inArray(salesInvoiceLines.salesInvoiceId, ids))
          .groupBy(salesInvoiceLines.salesInvoiceId)
      : [];
    const qm = new Map(agg.map((a) => [a.pid, a]));
    for (const r of list) {
      rows.push({
        id: `INVOICE-${r.id}`, number: r.number, date: r.date,
        customerName: custMap.get(r.customerId) ?? "—", docType: "INVOICE", status: r.status,
        qtyTotal: Number(qm.get(r.id)?.total ?? 0), qtyDelivered: null,
        subtotal: num(r.subtotal), discount: num(r.discount), tax: num(r.tax), total: num(r.total),
        href: `/erp/sales/invoices/${r.number}`,
      });
    }
  }

  // ── Sales Returns (credit notes — total only) ──
  if (want("RETURN")) {
    const conds = [eq(salesReturns.organizationId, orgId), ...dateConds(salesReturns.date)];
    if (matchedCustomerIds !== null) conds.push(matchedCustomerIds.length ? inArray(salesReturns.customerId, matchedCustomerIds) : sql`false`);
    if (matchedItemIds !== null) {
      const pids = await docIdsWithItem(salesReturnLines, salesReturnLines.salesReturnId, salesReturnLines.itemId, matchedItemIds);
      conds.push(pids.length ? inArray(salesReturns.id, pids) : sql`false`);
    }
    const list = await db
      .select({
        id: salesReturns.id, number: salesReturns.number, date: salesReturns.date,
        status: salesReturns.status, customerId: salesReturns.customerId, total: salesReturns.totalAmount,
      })
      .from(salesReturns)
      .where(and(...conds));
    const ids = list.map((r) => r.id);
    const agg = ids.length
      ? await db.select({
          pid: salesReturnLines.salesReturnId,
          total: sql<string>`coalesce(sum(${salesReturnLines.quantity}),0)`,
        }).from(salesReturnLines)
          .where(inArray(salesReturnLines.salesReturnId, ids))
          .groupBy(salesReturnLines.salesReturnId)
      : [];
    const qm = new Map(agg.map((a) => [a.pid, a]));
    for (const r of list) {
      rows.push({
        id: `RETURN-${r.id}`, number: r.number, date: r.date,
        customerName: custMap.get(r.customerId) ?? "—", docType: "RETURN", status: r.status,
        qtyTotal: Number(qm.get(r.id)?.total ?? 0), qtyDelivered: null,
        subtotal: null, discount: null, tax: null, total: num(r.total),
        href: `/erp/sales/returns/${r.number}`,
      });
    }
  }

  // Newest-first.
  rows.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const totals = rows.reduce(
    (acc, r) => {
      acc.qtyTotal += r.qtyTotal ?? 0;
      acc.qtyDelivered += r.qtyDelivered ?? 0;
      acc.subtotal += r.subtotal ?? 0;
      acc.discount += r.discount ?? 0;
      acc.tax += r.tax ?? 0;
      acc.total += r.total ?? 0;
      return acc;
    },
    { qtyTotal: 0, qtyDelivered: 0, subtotal: 0, discount: 0, tax: 0, total: 0 } as SalesLedgerTotals,
  );

  return { rows, totals, customers: custList, items: itemList };
}
