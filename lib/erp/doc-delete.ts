import "server-only";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  stockMovements, stockMovementBatches, journalEntries, journalEntryLines, documentLinks, auditLogs,
  purchaseReceipts, purchaseReceiptLines, purchaseInvoices, purchaseInvoiceLines,
  purchaseReturns, purchaseReturnLines, purchaseOrders, purchaseOrderLines,
  deliveryNotes, deliveryNoteLines, salesInvoices, salesReturns, salesReturnLines,
  salesOrders, salesOrderLines, paymentVouchers, paymentLines, receiptVouchers, receiptLines,
  landedCostVouchers, landedCostVoucherLines,
} from "@/db/schema";
import type { Dependent } from "@/lib/erp/doc-dependents";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Every document in the system that can reach a cancelled/reversed state. A document
 * with no cancel path (sales invoice, stock adjustment, transfer, quotation, expense)
 * can never be purged and is deliberately absent.
 */
export type DocKind =
  | "receipt" | "invoice" | "delivery" | "landedCost"
  | "purchaseOrder" | "salesOrder" | "purchaseReturn" | "salesReturn"
  | "paymentVoucher" | "receiptVoucher";

export const DOC_LABEL: Record<DocKind, string> = {
  receipt: "إذن الاستلام",
  invoice: "فاتورة الشراء",
  delivery: "إذن الصرف",
  landedCost: "مستند تكاليف الاستيراد",
  purchaseOrder: "أمر الشراء",
  salesOrder: "أمر البيع",
  purchaseReturn: "مرتجع الشراء",
  salesReturn: "مرتجع البيع",
  paymentVoucher: "سند الصرف",
  receiptVoucher: "سند القبض",
};

/** A document is purgeable only from one of these terminal, zero-effect states. */
export const PURGEABLE_STATUSES = ["CANCELLED", "REVERSED"];

const EPS = 1e-6;
/** SM-YYYY-NNNN → NNNN. Movements are ordered by (created_at, this) everywhere. */
const seqOf = (number: string) => Number(number.split("-")[2] ?? 0);

/**
 * Documents still pointing at this one. Unlike `doc-dependents`, this deliberately does
 * NOT look at stock consumption: a cancelled document's goods were already put back, so
 * "what consumed the stock" is meaningless here — only real references block a delete.
 */
export async function cancelledDocReferences(orgId: string, kind: DocKind, id: string): Promise<Dependent[]> {
  const deps: Dependent[] = [];

  if (kind === "receipt") {
    const inv = await db.select({ number: purchaseInvoices.number }).from(purchaseInvoices)
      .where(and(eq(purchaseInvoices.goodsReceiptId, id), eq(purchaseInvoices.organizationId, orgId), ne(purchaseInvoices.status, "CANCELLED")));
    for (const r of inv) deps.push({ label: "فاتورة شراء", number: r.number, href: `/purchases/invoices/${encodeURIComponent(r.number)}` });

    const rets = await db.select({ number: purchaseReturns.number }).from(purchaseReturns)
      .where(and(eq(purchaseReturns.purchaseReceiptId, id), eq(purchaseReturns.organizationId, orgId), ne(purchaseReturns.status, "CANCELLED")));
    for (const r of rets) deps.push({ label: "مرتجع شراء", number: r.number, href: `/purchases/returns/${encodeURIComponent(r.number)}` });

    const lcv = await db.selectDistinct({ number: landedCostVouchers.number })
      .from(landedCostVoucherLines)
      .innerJoin(landedCostVouchers, eq(landedCostVouchers.id, landedCostVoucherLines.voucherId))
      .where(and(eq(landedCostVoucherLines.purchaseReceiptId, id), eq(landedCostVouchers.organizationId, orgId), ne(landedCostVouchers.status, "CANCELLED")));
    for (const r of lcv) deps.push({ label: "تكاليف استيراد", number: r.number, href: `/purchases/landed-costs/${encodeURIComponent(r.number)}` });
  }

  if (kind === "invoice") {
    const rets = await db.select({ number: purchaseReturns.number }).from(purchaseReturns)
      .where(and(eq(purchaseReturns.purchaseInvoiceId, id), eq(purchaseReturns.organizationId, orgId), ne(purchaseReturns.status, "CANCELLED")));
    for (const r of rets) deps.push({ label: "مرتجع شراء", number: r.number, href: `/purchases/returns/${encodeURIComponent(r.number)}` });

    const pays = await db.select({ number: paymentVouchers.number }).from(paymentVouchers)
      .where(and(eq(paymentVouchers.purchaseInvoiceId, id), eq(paymentVouchers.organizationId, orgId), ne(paymentVouchers.status, "CANCELLED")));
    for (const r of pays) deps.push({ label: "سند صرف", number: r.number, href: `/purchases/payments/${encodeURIComponent(r.number)}` });

    const grn = await db.select({ number: purchaseReceipts.number }).from(purchaseReceipts)
      .where(and(eq(purchaseReceipts.purchaseInvoiceId, id), eq(purchaseReceipts.organizationId, orgId)));
    for (const r of grn) deps.push({ label: "إذن استلام", number: r.number, href: `/purchases/receipts/${encodeURIComponent(r.number)}` });
  }

  if (kind === "delivery") {
    const inv = await db.select({ number: salesInvoices.number }).from(salesInvoices)
      .where(and(eq(salesInvoices.deliveryNoteId, id), eq(salesInvoices.organizationId, orgId), ne(salesInvoices.status, "CANCELLED")));
    for (const r of inv) deps.push({ label: "فاتورة بيع", number: r.number, href: `/sales/invoices/${encodeURIComponent(r.number)}` });

    const rets = await db.select({ number: salesReturns.number }).from(salesReturns)
      .where(and(eq(salesReturns.deliveryNoteId, id), eq(salesReturns.organizationId, orgId), ne(salesReturns.status, "CANCELLED")));
    for (const r of rets) deps.push({ label: "مرتجع بيع", number: r.number, href: `/sales/returns/${encodeURIComponent(r.number)}` });
  }

  // An order is the head of its cycle: anything raised from it must go first.
  if (kind === "purchaseOrder") {
    const grn = await db.select({ number: purchaseReceipts.number }).from(purchaseReceipts)
      .where(and(eq(purchaseReceipts.purchaseOrderId, id), eq(purchaseReceipts.organizationId, orgId)));
    for (const r of grn) deps.push({ label: "إذن استلام", number: r.number, href: `/purchases/receipts/${encodeURIComponent(r.number)}` });

    const rets = await db.select({ number: purchaseReturns.number }).from(purchaseReturns)
      .where(and(eq(purchaseReturns.purchaseOrderId, id), eq(purchaseReturns.organizationId, orgId), ne(purchaseReturns.status, "CANCELLED")));
    for (const r of rets) deps.push({ label: "مرتجع شراء", number: r.number, href: `/purchases/returns/${encodeURIComponent(r.number)}` });
  }

  if (kind === "salesOrder") {
    const dn = await db.select({ number: deliveryNotes.number }).from(deliveryNotes)
      .where(and(eq(deliveryNotes.salesOrderId, id), eq(deliveryNotes.organizationId, orgId)));
    for (const r of dn) deps.push({ label: "إذن صرف", number: r.number, href: `/sales/deliveries/${encodeURIComponent(r.number)}` });

    const inv = await db.select({ number: salesInvoices.number }).from(salesInvoices)
      .where(and(eq(salesInvoices.salesOrderId, id), eq(salesInvoices.organizationId, orgId), ne(salesInvoices.status, "CANCELLED")));
    for (const r of inv) deps.push({ label: "فاتورة بيع", number: r.number, href: `/sales/invoices/${encodeURIComponent(r.number)}` });
  }

  // Vouchers and returns are leaves — nothing is ever raised from them, so only the
  // ledger-safety check stands between them and a delete.
  return deps;
}

/**
 * Is it safe to erase this document's stock movements?
 *
 * Every movement stores the running balance AFTER it. Removing a pair of movements is
 * only safe when (a) they truly net to zero, and (b) nothing else for the same
 * (item, warehouse) happened BETWEEN them — otherwise those in-between rows keep balances
 * that were computed while this document's effect was still counted, and the ledger would
 * silently disagree with itself from that point on.
 */
export async function ledgerSafeToPurge(orgId: string, docId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const ours = await db
    .select({ number: stockMovements.number, itemId: stockMovements.itemId, warehouseId: stockMovements.warehouseId,
              balanceQuantity: stockMovements.balanceQuantity, balanceValue: stockMovements.balanceValue })
    .from(stockMovements)
    .where(and(eq(stockMovements.organizationId, orgId), eq(stockMovements.referenceId, docId)));
  if (!ours.length) return { ok: true }; // nothing was posted — always safe

  const bins = [...new Set(ours.map((m) => `${m.itemId}|${m.warehouseId}`))];
  const all = await db
    .select({ number: stockMovements.number, itemId: stockMovements.itemId, warehouseId: stockMovements.warehouseId,
              referenceId: stockMovements.referenceId,
              balanceQuantity: stockMovements.balanceQuantity, balanceValue: stockMovements.balanceValue })
    .from(stockMovements)
    .where(and(
      eq(stockMovements.organizationId, orgId),
      inArray(stockMovements.itemId, [...new Set(ours.map((m) => m.itemId))]),
      inArray(stockMovements.warehouseId, [...new Set(ours.map((m) => m.warehouseId))]),
    ));

  for (const bin of bins) {
    const [itemId, warehouseId] = bin.split("|");
    const rows = all.filter((m) => m.itemId === itemId && m.warehouseId === warehouseId);
    const verdict = binPurgeVerdict(rows, docId);
    if (verdict.kind === "interleaved") {
      return { ok: false, error: `تمّت حركات مخزون أخرى على أحد الأصناف بين حركتَي هذا المستند وعكسه (${verdict.at}) — حذفه سيُفسد أرصدة الدفتر. الإلغاء وحده كافٍ: أثره صفر بالفعل.` };
    }
    if (verdict.kind === "not-zero") {
      return { ok: false, error: "أثر هذا المستند على المخزون لم يُعكس بالكامل — لا يمكن حذفه." };
    }
  }
  return { ok: true };
}

export type BinRow = { number: string; referenceId: string | null; balanceQuantity: string | number; balanceValue: string | number };
export type BinVerdict = { kind: "ok" } | { kind: "interleaved"; at: string } | { kind: "not-zero" };

/**
 * The rule, as a pure function over one (item, warehouse) bin — this is the part worth
 * testing, so it is kept free of I/O.
 *
 * Erasing movements is safe only when the document's own rows sit in an unbroken run
 * (nothing else slipped between the first and the last), and the balance it started from
 * equals the balance it left behind. Anything else means later rows carry balances that
 * were computed while this document still counted.
 */
export function binPurgeVerdict(rows: BinRow[], docId: string): BinVerdict {
  const sorted = [...rows].sort((a, b) => seqOf(a.number) - seqOf(b.number));
  const mine = sorted.filter((m) => m.referenceId === docId);
  if (!mine.length) return { kind: "ok" };

  const lo = seqOf(mine[0].number), hi = seqOf(mine[mine.length - 1].number);
  const between = sorted.find((m) => m.referenceId !== docId && seqOf(m.number) > lo && seqOf(m.number) < hi);
  if (between) return { kind: "interleaved", at: between.number };

  const before = sorted.filter((m) => seqOf(m.number) < lo).pop();
  const beforeQty = before ? Number(before.balanceQuantity) : 0;
  const beforeVal = before ? Number(before.balanceValue) : 0;
  const last = mine[mine.length - 1];
  if (Math.abs(Number(last.balanceQuantity) - beforeQty) > EPS || Math.abs(Number(last.balanceValue) - beforeVal) > 0.004) {
    return { kind: "not-zero" };
  }
  return { kind: "ok" };
}

/**
 * Erase a cancelled document and everything it wrote: its journal entries (the posting
 * AND its reversal, which net to zero), its stock movements, links and audit rows, then
 * the document itself. Callers MUST have run `cancelledDocReferences` and
 * `ledgerSafeToPurge` first. Stock lots are left alone — they may be shared, and one with
 * nothing remaining holds no quantity or value.
 */
export async function purgeDocument(tx: Tx, orgId: string, kind: DocKind, id: string): Promise<void> {
  // Journal entries: this doc's own, plus the reversals that point at them.
  const mine = await tx.select({ id: journalEntries.id }).from(journalEntries)
    .where(and(eq(journalEntries.organizationId, orgId), eq(journalEntries.sourceId, id)));
  const mineIds = mine.map((e) => e.id);
  const reversals = mineIds.length
    ? await tx.select({ id: journalEntries.id }).from(journalEntries)
        .where(and(eq(journalEntries.organizationId, orgId), inArray(journalEntries.sourceId, mineIds)))
    : [];
  const allEntryIds = [...mineIds, ...reversals.map((e) => e.id)];
  if (allEntryIds.length) {
    // Drop the self-reference first so the pair can be deleted in any order.
    await tx.update(journalEntries).set({ reversedById: null }).where(inArray(journalEntries.id, allEntryIds));
    await tx.delete(journalEntryLines).where(inArray(journalEntryLines.journalEntryId, allEntryIds));
    await tx.delete(journalEntries).where(inArray(journalEntries.id, allEntryIds));
  }

  const moves = await tx.select({ id: stockMovements.id }).from(stockMovements)
    .where(and(eq(stockMovements.organizationId, orgId), eq(stockMovements.referenceId, id)));
  if (moves.length) {
    await tx.delete(stockMovementBatches).where(inArray(stockMovementBatches.movementId, moves.map((m) => m.id)));
    await tx.delete(stockMovements).where(inArray(stockMovements.id, moves.map((m) => m.id)));
  }

  await tx.delete(documentLinks).where(and(eq(documentLinks.organizationId, orgId), sql`(${documentLinks.fromId} = ${id} OR ${documentLinks.toId} = ${id})`));
  await tx.delete(auditLogs).where(and(eq(auditLogs.organizationId, orgId), eq(auditLogs.entityId, id)));

  switch (kind) {
    case "receipt":
      await tx.delete(purchaseReceiptLines).where(eq(purchaseReceiptLines.purchaseReceiptId, id));
      await tx.delete(purchaseReceipts).where(and(eq(purchaseReceipts.id, id), eq(purchaseReceipts.organizationId, orgId)));
      break;
    case "invoice":
      await tx.delete(purchaseInvoiceLines).where(eq(purchaseInvoiceLines.purchaseInvoiceId, id));
      await tx.delete(purchaseInvoices).where(and(eq(purchaseInvoices.id, id), eq(purchaseInvoices.organizationId, orgId)));
      break;
    case "delivery":
      await tx.delete(deliveryNoteLines).where(eq(deliveryNoteLines.deliveryNoteId, id));
      await tx.delete(deliveryNotes).where(and(eq(deliveryNotes.id, id), eq(deliveryNotes.organizationId, orgId)));
      break;
    case "landedCost":
      await tx.delete(landedCostVoucherLines).where(eq(landedCostVoucherLines.voucherId, id));
      await tx.delete(landedCostVouchers).where(and(eq(landedCostVouchers.id, id), eq(landedCostVouchers.organizationId, orgId)));
      break;
    case "purchaseOrder":
      await tx.delete(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, id));
      await tx.delete(purchaseOrders).where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.organizationId, orgId)));
      break;
    case "salesOrder":
      await tx.delete(salesOrderLines).where(eq(salesOrderLines.salesOrderId, id));
      await tx.delete(salesOrders).where(and(eq(salesOrders.id, id), eq(salesOrders.organizationId, orgId)));
      break;
    case "purchaseReturn":
      await tx.delete(purchaseReturnLines).where(eq(purchaseReturnLines.purchaseReturnId, id));
      await tx.delete(purchaseReturns).where(and(eq(purchaseReturns.id, id), eq(purchaseReturns.organizationId, orgId)));
      break;
    case "salesReturn":
      await tx.delete(salesReturnLines).where(eq(salesReturnLines.salesReturnId, id));
      await tx.delete(salesReturns).where(and(eq(salesReturns.id, id), eq(salesReturns.organizationId, orgId)));
      break;
    case "paymentVoucher":
      await tx.delete(paymentLines).where(eq(paymentLines.paymentVoucherId, id));
      await tx.delete(paymentVouchers).where(and(eq(paymentVouchers.id, id), eq(paymentVouchers.organizationId, orgId)));
      break;
    case "receiptVoucher":
      await tx.delete(receiptLines).where(eq(receiptLines.receiptVoucherId, id));
      await tx.delete(receiptVouchers).where(and(eq(receiptVouchers.id, id), eq(receiptVouchers.organizationId, orgId)));
      break;
  }
}
