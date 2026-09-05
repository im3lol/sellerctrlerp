import { and, eq, gte, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  stockMovements, purchaseInvoices, purchaseReturns, salesInvoices, salesReturns,
  deliveryNotes, purchaseReceipts, stockAdjustments, stockTransfers, landedCostVouchers,
  landedCostVoucherLines, stockBatches, paymentVouchers,
} from "@/db/schema";

/**
 * A document that stands in the way of cancelling/deleting another one — named, so the
 * refusal can say WHICH document instead of a vague "it's linked to something".
 */
export type Dependent = { label: string; number: string; href: string };

const EPS = 1e-6;

/** "فاتورة شراء PI-2026-0012، إذن صرف DLV-2026-0044" */
export const dependentsList = (deps: Dependent[]) => deps.map((d) => `${d.label} ${d.number}`).join("، ");

/** The stock-movement reference types that CONSUME stock, mapped to their document. */
const CONSUMERS: Record<string, { label: string; table: "salesInvoices" | "deliveryNotes" | "salesReturns" | "purchaseReturns" | "stockAdjustments" | "stockTransfers" | "purchaseInvoices"; href: (n: string) => string }> = {
  DELIVERY: { label: "إذن صرف", table: "deliveryNotes", href: (n) => `/sales/deliveries/${encodeURIComponent(n)}` },
  SALES_INVOICE: { label: "فاتورة بيع", table: "salesInvoices", href: (n) => `/sales/invoices/${encodeURIComponent(n)}` },
  SALES_RETURN: { label: "مرتجع بيع", table: "salesReturns", href: (n) => `/sales/returns/${encodeURIComponent(n)}` },
  PURCHASE_RETURN: { label: "مرتجع شراء", table: "purchaseReturns", href: (n) => `/purchases/returns/${encodeURIComponent(n)}` },
  ADJUSTMENT: { label: "تسوية مخزون", table: "stockAdjustments", href: (n) => `/inventory/adjustments/${encodeURIComponent(n)}` },
  TRANSFER: { label: "تحويل مخزون", table: "stockTransfers", href: (n) => `/inventory/transfers/${encodeURIComponent(n)}` },
  PURCHASE_INVOICE: { label: "فاتورة شراء", table: "purchaseInvoices", href: (n) => `/purchases/invoices/${encodeURIComponent(n)}` },
};

const TABLES = {
  salesInvoices, deliveryNotes, salesReturns, purchaseReturns, stockAdjustments, stockTransfers, purchaseInvoices,
} as const;

/**
 * Documents that moved this stock AFTER the given date — the "البضاعة اتحركت/اتباعت"
 * blockers. Only consulted for the (item, warehouse) pairs the caller actually posted,
 * and only when on-hand fell below what was posted (lots merge, so the goods can't be
 * traced individually — a shortfall is the honest signal that something consumed them).
 */
export async function stockConsumers(
  orgId: string,
  lines: { itemId: string; warehouseId: string; quantity: number }[],
  since: Date,
): Promise<Dependent[]> {
  if (!lines.length) return [];
  const itemIds = [...new Set(lines.map((l) => l.itemId))];
  const whIds = [...new Set(lines.map((l) => l.warehouseId))];

  // On-hand per (item, warehouse) — a shortfall vs. what was posted means it moved on.
  const bal = await db
    .select({ itemId: stockBatches.itemId, warehouseId: stockBatches.warehouseId, qty: sql<string>`sum(${stockBatches.remainingQuantity})` })
    .from(stockBatches)
    .where(and(eq(stockBatches.organizationId, orgId), inArray(stockBatches.itemId, itemIds), inArray(stockBatches.warehouseId, whIds)))
    .groupBy(stockBatches.itemId, stockBatches.warehouseId);
  const onHand = new Map(bal.map((b) => [`${b.itemId}|${b.warehouseId}`, Number(b.qty)]));

  const short = lines.filter((l) => (onHand.get(`${l.itemId}|${l.warehouseId}`) ?? 0) + EPS < l.quantity);
  if (!short.length) return [];

  // Whatever took stock out of those bins since the document's date.
  const moves = await db
    .select({ refType: stockMovements.referenceType, refId: stockMovements.referenceId })
    .from(stockMovements)
    .where(and(
      eq(stockMovements.organizationId, orgId),
      inArray(stockMovements.itemId, [...new Set(short.map((l) => l.itemId))]),
      inArray(stockMovements.warehouseId, [...new Set(short.map((l) => l.warehouseId))]),
      gte(stockMovements.date, since),
      eq(stockMovements.type, "OUT"),
    ))
    .limit(500);

  return resolveRefs(orgId, moves);
}

/** Turn (referenceType, referenceId) pairs into named, linkable documents. */
async function resolveRefs(orgId: string, refs: { refType: string | null; refId: string | null }[]): Promise<Dependent[]> {
  const byType = new Map<string, Set<string>>();
  for (const m of refs) {
    if (!m.refType || !m.refId || !CONSUMERS[m.refType]) continue;
    const set = byType.get(m.refType) ?? new Set<string>();
    set.add(m.refId);
    byType.set(m.refType, set);
  }

  const out: Dependent[] = [];
  for (const [type, ids] of byType) {
    const cfg = CONSUMERS[type];
    const table = TABLES[cfg.table];
    const rows = await db.select({ number: table.number }).from(table)
      .where(and(eq(table.organizationId, orgId), inArray(table.id, [...ids]))).limit(20);
    for (const r of rows) out.push({ label: cfg.label, number: r.number, href: cfg.href(r.number) });
  }
  return out;
}

/**
 * Everything standing in the way of cancelling a goods receipt: its invoice, its
 * returns, any posted landed-cost voucher that loaded cost onto it, and whatever
 * consumed the received stock.
 */
export async function goodsReceiptDependents(orgId: string, grnId: string): Promise<Dependent[]> {
  const [grn] = await db.select().from(purchaseReceipts)
    .where(and(eq(purchaseReceipts.id, grnId), eq(purchaseReceipts.organizationId, orgId))).limit(1);
  if (!grn) return [];

  const deps: Dependent[] = [];

  if (grn.purchaseInvoiceId) {
    const [inv] = await db.select({ number: purchaseInvoices.number }).from(purchaseInvoices)
      .where(and(eq(purchaseInvoices.id, grn.purchaseInvoiceId), eq(purchaseInvoices.organizationId, orgId))).limit(1);
    if (inv) deps.push({ label: "فاتورة شراء", number: inv.number, href: `/purchases/invoices/${encodeURIComponent(inv.number)}` });
  }

  const rets = await db.select({ number: purchaseReturns.number }).from(purchaseReturns)
    .where(and(eq(purchaseReturns.purchaseReceiptId, grn.id), eq(purchaseReturns.organizationId, orgId), ne(purchaseReturns.status, "CANCELLED")));
  for (const r of rets) deps.push({ label: "مرتجع شراء", number: r.number, href: `/purchases/returns/${encodeURIComponent(r.number)}` });

  // A posted voucher already capitalised freight onto these goods.
  const lcv = await db.selectDistinct({ number: landedCostVouchers.number, status: landedCostVouchers.status })
    .from(landedCostVoucherLines)
    .innerJoin(landedCostVouchers, eq(landedCostVouchers.id, landedCostVoucherLines.voucherId))
    .where(and(eq(landedCostVoucherLines.purchaseReceiptId, grn.id), eq(landedCostVouchers.organizationId, orgId), ne(landedCostVouchers.status, "CANCELLED")));
  for (const v of lcv) deps.push({ label: "تكاليف استيراد", number: v.number, href: `/purchases/landed-costs/${encodeURIComponent(v.number)}` });

  const lines = await db.select({ itemId: sql<string>`item_id`, warehouseId: sql<string>`coalesce(warehouse_id, ${grn.warehouseId})`, quantity: sql<string>`quantity` })
    .from(sql`purchase_receipt_lines`)
    .where(sql`purchase_receipt_id = ${grn.id}`);
  const consumers = await stockConsumers(
    orgId,
    lines.map((l) => ({ itemId: l.itemId, warehouseId: l.warehouseId, quantity: Number(l.quantity) })).filter((l) => l.quantity > EPS),
    new Date(grn.date),
  );
  // The receipt's own documents are already listed above — don't repeat them.
  const seen = new Set(deps.map((d) => `${d.label}|${d.number}`));
  for (const c of consumers) if (!seen.has(`${c.label}|${c.number}`)) { seen.add(`${c.label}|${c.number}`); deps.push(c); }

  return deps;
}

/**
 * Everything standing in the way of cancelling a posted purchase invoice: its returns
 * (credit notes) and any payment already applied to it.
 */
export async function purchaseInvoiceDependents(orgId: string, invoiceId: string): Promise<Dependent[]> {
  const [inv] = await db.select({ id: purchaseInvoices.id, paidAmount: purchaseInvoices.paidAmount })
    .from(purchaseInvoices)
    .where(and(eq(purchaseInvoices.id, invoiceId), eq(purchaseInvoices.organizationId, orgId))).limit(1);
  if (!inv) return [];

  const deps: Dependent[] = [];

  const rets = await db.select({ number: purchaseReturns.number }).from(purchaseReturns)
    .where(and(eq(purchaseReturns.purchaseInvoiceId, inv.id), eq(purchaseReturns.organizationId, orgId), ne(purchaseReturns.status, "CANCELLED")));
  for (const r of rets) deps.push({ label: "مرتجع شراء", number: r.number, href: `/purchases/returns/${encodeURIComponent(r.number)}` });

  if (Number(inv.paidAmount) > 0.004) {
    const pays = await db.select({ number: paymentVouchers.number }).from(paymentVouchers)
      .where(and(eq(paymentVouchers.purchaseInvoiceId, inv.id), eq(paymentVouchers.organizationId, orgId), ne(paymentVouchers.status, "CANCELLED")));
    for (const p of pays) deps.push({ label: "سند صرف", number: p.number, href: `/purchases/payments/${encodeURIComponent(p.number)}` });
  }

  return deps;
}

/** Everything standing in the way of cancelling a delivery note: its invoice and its returns. */
export async function deliveryDependents(orgId: string, deliveryId: string): Promise<Dependent[]> {
  const [dn] = await db.select().from(deliveryNotes)
    .where(and(eq(deliveryNotes.id, deliveryId), eq(deliveryNotes.organizationId, orgId))).limit(1);
  if (!dn) return [];

  const deps: Dependent[] = [];
  if (dn.salesInvoiceId) {
    const [inv] = await db.select({ number: salesInvoices.number }).from(salesInvoices)
      .where(and(eq(salesInvoices.id, dn.salesInvoiceId), eq(salesInvoices.organizationId, orgId))).limit(1);
    if (inv) deps.push({ label: "فاتورة بيع", number: inv.number, href: `/sales/invoices/${encodeURIComponent(inv.number)}` });
  }
  const rets = await db.select({ number: salesReturns.number }).from(salesReturns)
    .where(and(eq(salesReturns.deliveryNoteId, dn.id), eq(salesReturns.organizationId, orgId), ne(salesReturns.status, "CANCELLED")));
  for (const r of rets) deps.push({ label: "مرتجع بيع", number: r.number, href: `/sales/returns/${encodeURIComponent(r.number)}` });

  return deps;
}
