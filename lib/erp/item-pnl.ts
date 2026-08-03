import "server-only";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  salesInvoiceLines, salesInvoices, salesOrderLines, salesOrders,
  purchaseInvoiceLines, purchaseInvoices, purchaseReceiptLines, purchaseReceipts,
  salesReturnLines, salesReturns, marketplaceSettlementTxns, itemCodes,
} from "@/db/schema";
import { normalizeCode } from "@/lib/erp/amazon-import";
import { liveInvoice } from "@/lib/erp/invoice-status";

export type ItemPnl = {
  units: number;        // units sold (posted invoices)
  revenue: number;      // net-of-VAT sales revenue
  cogs: number;         // cost of goods sold
  referralFee: number;  // Amazon commission (actual, from settlement)
  fbaFee: number;       // Amazon FBA fee (actual)
  otherFee: number;     // other Amazon transaction fees (actual)
  amazonFees: number;   // referral + fba + other
  net: number;          // revenue − cogs − amazonFees
  margin: number;       // net / revenue %
  hasSettlement: boolean;
};

/**
 * Per-product P&L: booked revenue/COGS/units from posted sales-invoice lines +
 * ACTUAL Amazon fees from settlement transactions (matched by normalized SKU/ASIN).
 * Fees are the real charges Amazon deducted, not the pre-sale estimate.
 */
export async function getItemPnl(orgId: string, itemId: string, itemCode: string): Promise<ItemPnl> {
  // The item's marketplace codes (SKU/ASIN…) normalized, to match settlement `sku`.
  const codeRows = await db.select({ n: itemCodes.normalizedCode }).from(itemCodes)
    .where(and(eq(itemCodes.organizationId, orgId), eq(itemCodes.itemId, itemId)));
  const norms = [...new Set([...codeRows.map((r) => r.n).filter(Boolean) as string[], normalizeCode(itemCode)])];

  const [sales] = await db
    .select({
      units: sql<string>`coalesce(sum(${salesInvoiceLines.quantity}), 0)`,
      revenue: sql<string>`coalesce(sum(${salesInvoiceLines.totalAmount} - ${salesInvoiceLines.taxAmount}), 0)`,
      cogs: sql<string>`coalesce(sum(${salesInvoiceLines.costAmount}), 0)`,
    })
    .from(salesInvoiceLines)
    .innerJoin(salesInvoices, eq(salesInvoices.id, salesInvoiceLines.salesInvoiceId))
    .where(and(
      eq(salesInvoices.organizationId, orgId),
      eq(salesInvoiceLines.itemId, itemId),
      liveInvoice(salesInvoices.status),
    ));

  // Actual Amazon fees for this item's SKUs (regexp mirrors normalizeCode: upper + strip non-alnum).
  const [fees] = norms.length
    ? await db.select({
        referral: sql<string>`coalesce(-sum(${marketplaceSettlementTxns.sellingFees}), 0)`,
        fba: sql<string>`coalesce(-sum(${marketplaceSettlementTxns.fbaFees}), 0)`,
        other: sql<string>`coalesce(-sum(${marketplaceSettlementTxns.otherTransactionFees}), 0)`,
        n: sql<string>`count(*)`,
      })
      .from(marketplaceSettlementTxns)
      .where(and(
        eq(marketplaceSettlementTxns.organizationId, orgId),
        sql`regexp_replace(upper(coalesce(${marketplaceSettlementTxns.sku}, '')), '[^A-Z0-9]', '', 'g') = ANY(${norms})`,
      ))
    : [{ referral: "0", fba: "0", other: "0", n: "0" }];

  const revenue = Number(sales?.revenue ?? 0);
  const cogs = Number(sales?.cogs ?? 0);
  const referralFee = Number(fees?.referral ?? 0);
  const fbaFee = Number(fees?.fba ?? 0);
  const otherFee = Number(fees?.other ?? 0);
  const amazonFees = referralFee + fbaFee + otherFee;
  const net = revenue - cogs - amazonFees;
  return {
    units: Number(sales?.units ?? 0), revenue, cogs, referralFee, fbaFee, otherFee, amazonFees,
    net, margin: revenue > 0 ? (net / revenue) * 100 : 0,
    hasSettlement: Number(fees?.n ?? 0) > 0,
  };
}

/**
 * ACTUAL Amazon fees per item from settlements in a date window (by settlement
 * postedAt), matched by normalized SKU → item_codes. Returns positive expense per
 * itemId. Set-based counterpart to getItemPnl's fee query — used by the profitability
 * report + its export/print so all three show the same real (not estimated) fees.
 */
export async function getSettlementFeesByItem(orgId: string, from: Date, to: Date): Promise<Map<string, number>> {
  const norm = sql<string>`regexp_replace(upper(coalesce(${marketplaceSettlementTxns.sku}, '')), '[^A-Z0-9]', '', 'g')`;
  const feeRows = await db.select({
    sku: norm,
    fees: sql<string>`coalesce(-sum(${marketplaceSettlementTxns.sellingFees} + ${marketplaceSettlementTxns.fbaFees} + ${marketplaceSettlementTxns.otherTransactionFees}), 0)`,
  })
    .from(marketplaceSettlementTxns)
    .where(and(eq(marketplaceSettlementTxns.organizationId, orgId), gte(marketplaceSettlementTxns.postedAt, from), lte(marketplaceSettlementTxns.postedAt, to)))
    .groupBy(norm);

  const codeRows = await db.select({ itemId: itemCodes.itemId, n: itemCodes.normalizedCode })
    .from(itemCodes).where(eq(itemCodes.organizationId, orgId));
  const itemByNorm = new Map(codeRows.filter((r) => r.n).map((r) => [r.n as string, r.itemId]));

  const out = new Map<string, number>();
  for (const r of feeRows) {
    const itemId = r.sku ? itemByNorm.get(r.sku) : undefined;
    if (itemId) out.set(itemId, (out.get(itemId) ?? 0) + Number(r.fees ?? 0));
  }
  return out;
}

export type ItemDoc = { kind: string; number: string; date: Date; qty: number; href: string };

/** Every document that touched this item — sales + purchases, newest first. */
export async function getItemLinkedDocs(orgId: string, itemId: string, limit = 40): Promise<ItemDoc[]> {
  const [inv, ord, ret, pinv, prec] = await Promise.all([
    db.select({ number: salesInvoices.number, date: salesInvoices.date, qty: sql<string>`sum(${salesInvoiceLines.quantity})` })
      .from(salesInvoiceLines).innerJoin(salesInvoices, eq(salesInvoices.id, salesInvoiceLines.salesInvoiceId))
      .where(and(eq(salesInvoices.organizationId, orgId), eq(salesInvoiceLines.itemId, itemId)))
      .groupBy(salesInvoices.id, salesInvoices.number, salesInvoices.date).orderBy(desc(salesInvoices.date)).limit(limit),
    db.select({ number: salesOrders.number, date: salesOrders.date, qty: sql<string>`sum(${salesOrderLines.quantity})` })
      .from(salesOrderLines).innerJoin(salesOrders, eq(salesOrders.id, salesOrderLines.salesOrderId))
      .where(and(eq(salesOrders.organizationId, orgId), eq(salesOrderLines.itemId, itemId)))
      .groupBy(salesOrders.id, salesOrders.number, salesOrders.date).orderBy(desc(salesOrders.date)).limit(limit),
    db.select({ number: salesReturns.number, date: salesReturns.date, qty: sql<string>`sum(${salesReturnLines.quantity})` })
      .from(salesReturnLines).innerJoin(salesReturns, eq(salesReturns.id, salesReturnLines.salesReturnId))
      .where(and(eq(salesReturns.organizationId, orgId), eq(salesReturnLines.itemId, itemId)))
      .groupBy(salesReturns.id, salesReturns.number, salesReturns.date).orderBy(desc(salesReturns.date)).limit(limit),
    db.select({ number: purchaseInvoices.number, date: purchaseInvoices.date, qty: sql<string>`sum(${purchaseInvoiceLines.quantity})` })
      .from(purchaseInvoiceLines).innerJoin(purchaseInvoices, eq(purchaseInvoices.id, purchaseInvoiceLines.purchaseInvoiceId))
      .where(and(eq(purchaseInvoices.organizationId, orgId), eq(purchaseInvoiceLines.itemId, itemId)))
      .groupBy(purchaseInvoices.id, purchaseInvoices.number, purchaseInvoices.date).orderBy(desc(purchaseInvoices.date)).limit(limit),
    db.select({ number: purchaseReceipts.number, date: purchaseReceipts.date, qty: sql<string>`sum(${purchaseReceiptLines.quantity})` })
      .from(purchaseReceiptLines).innerJoin(purchaseReceipts, eq(purchaseReceipts.id, purchaseReceiptLines.purchaseReceiptId))
      .where(and(eq(purchaseReceipts.organizationId, orgId), eq(purchaseReceiptLines.itemId, itemId)))
      .groupBy(purchaseReceipts.id, purchaseReceipts.number, purchaseReceipts.date).orderBy(desc(purchaseReceipts.date)).limit(limit),
  ]);

  const enc = encodeURIComponent;
  const docs: ItemDoc[] = [
    ...inv.map((r) => ({ kind: "فاتورة بيع", number: r.number, date: r.date, qty: Number(r.qty), href: `/sales/invoices/${enc(r.number)}` })),
    ...ord.map((r) => ({ kind: "أمر بيع", number: r.number, date: r.date, qty: Number(r.qty), href: `/sales/orders/${enc(r.number)}` })),
    ...ret.map((r) => ({ kind: "مرتجع بيع", number: r.number, date: r.date, qty: Number(r.qty), href: `/sales/returns/${enc(r.number)}` })),
    ...pinv.map((r) => ({ kind: "فاتورة شراء", number: r.number, date: r.date, qty: Number(r.qty), href: `/purchases/invoices/${enc(r.number)}` })),
    ...prec.map((r) => ({ kind: "إذن استلام", number: r.number, date: r.date, qty: Number(r.qty), href: `/purchases/receipts/${enc(r.number)}` })),
  ];
  return docs.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, limit);
}
