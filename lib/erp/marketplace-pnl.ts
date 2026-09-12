import "server-only";
import { and, eq, gte, inArray, lte, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  marketplaceSettlementTxns, marketplaceTxnItems, salesOrders, deliveryNotes,
  stockMovements, items, itemCodes,
} from "@/db/schema";
import { round2 } from "@/lib/erp/money";

/**
 * Marketplace profitability, read from what the channel actually charged.
 *
 * Two views of the same money, because they answer different questions. The ORDER view
 * answers "did this sale make money" — it is the row a trader checks against Seller
 * Central. The PRODUCT view answers "should I keep selling this" — it needs the fees
 * attributed per SKU, which only exists because listTransactions itemises them.
 *
 * Sales and fees come from the transaction feed (deferred included, so a recent order is
 * not silently missing its fees). Cost comes from the stock ledger, where it is actually
 * posted — see lib/erp/sales-cogs.ts for why not from the invoice line.
 */

export type OrderPnl = {
  externalOrderId: string; orderNumber: string | null; postedAt: Date | null;
  status: string; deferred: boolean;
  sales: number; refunds: number; commission: number; fbaFee: number; otherFees: number;
  // The tax half of each fee, kept separate because that is how Seller Central shows it —
  // a single combined figure is correct but impossible to check against Amazon at a glance.
  commissionTax: number; fbaFeeTax: number;
  fees: number; cogs: number; net: number; margin: number; hasCogs: boolean;
};

export type ProductPnl = {
  sku: string; asin: string | null; itemId: string | null; code: string | null; name: string | null;
  // `units` is NET: sold minus refunded. Amazon reports a refund's quantity as POSITIVE,
  // so summing it raw counted one sale and its refund as two pieces sold.
  units: number; unitsSold: number; unitsRefunded: number; sales: number; commission: number; fbaFee: number; otherFees: number;
  commissionTax: number; fbaFeeTax: number;
  fees: number; cogs: number; net: number; margin: number;
  unitSale: number; unitFees: number; unitCost: number; breakEven: number; hasCogs: boolean;
};

const n = (v: unknown) => Number(v ?? 0);
/** OUT is a sale, IN is a return coming back. */
const signedCost = sql<string>`coalesce(sum(case when ${stockMovements.type} = 'OUT' then ${stockMovements.totalCost} else -${stockMovements.totalCost} end), 0)`;

const matchPlatform = (channel: string, platformId: string | null) =>
  platformId ? or(eq(salesOrders.platformId, platformId), eq(salesOrders.channel, channel)) : eq(salesOrders.channel, channel);

/** Per-order: one row per marketplace order that has any money against it. */
export async function getOrderPnl(
  orgId: string, channel: string, platformId: string | null, from: Date, to: Date,
): Promise<OrderPnl[]> {
  const txns = await db.select({
    externalOrderId: marketplaceSettlementTxns.orderId,
    salesOrderId: marketplaceSettlementTxns.salesOrderId,
    orderNumber: salesOrders.number,
    type: marketplaceSettlementTxns.type,
    status: marketplaceSettlementTxns.status,
    postedAt: marketplaceSettlementTxns.postedAt,
    productSales: marketplaceSettlementTxns.productSales,
    sellingFees: marketplaceSettlementTxns.sellingFees,
    fbaFees: marketplaceSettlementTxns.fbaFees,
    otherTransactionFees: marketplaceSettlementTxns.otherTransactionFees,
    total: marketplaceSettlementTxns.total,
  })
    .from(marketplaceSettlementTxns)
    .leftJoin(salesOrders, eq(salesOrders.id, marketplaceSettlementTxns.salesOrderId))
    .where(and(
      eq(marketplaceSettlementTxns.organizationId, orgId),
      eq(marketplaceSettlementTxns.channel, channel),
      // Ads charges, service fees and adjustments have no order — they belong to the
      // platform P&L, not to any one sale.
      sql`coalesce(${marketplaceSettlementTxns.orderId}, '') <> ''`,
      gte(marketplaceSettlementTxns.postedAt, from),
      lte(marketplaceSettlementTxns.postedAt, to),
    ));

  // Cost per order, from the deliveries that shipped it.
  const orderIds = [...new Set(txns.map((t) => t.salesOrderId).filter((x): x is string => !!x))];
  const cogsByOrder = new Map<string, number>();
  if (orderIds.length) {
    const rows = await db.select({ orderId: deliveryNotes.salesOrderId, cogs: signedCost })
      .from(stockMovements)
      .innerJoin(deliveryNotes, and(eq(deliveryNotes.id, stockMovements.referenceId), eq(stockMovements.referenceType, "DELIVERY")))
      .where(and(eq(stockMovements.organizationId, orgId), inArray(deliveryNotes.salesOrderId, orderIds)))
      .groupBy(deliveryNotes.salesOrderId);
    for (const r of rows) if (r.orderId) cogsByOrder.set(r.orderId, n(r.cogs));
  }

  // The parent row carries each fee inclusive of its tax; the split lives on the items.
  const taxByOrder = new Map<string, { commissionTax: number; fbaFeeTax: number }>();
  {
    const tRows = await db.select({
      orderId: marketplaceSettlementTxns.orderId,
      commissionTax: sql<string>`coalesce(sum(${marketplaceTxnItems.commissionTax}), 0)`,
      fbaFeeTax: sql<string>`coalesce(sum(${marketplaceTxnItems.fbaFeeTax}), 0)`,
    })
      .from(marketplaceTxnItems)
      .innerJoin(marketplaceSettlementTxns, eq(marketplaceSettlementTxns.id, marketplaceTxnItems.txnId))
      .where(and(
        eq(marketplaceTxnItems.organizationId, orgId),
        eq(marketplaceSettlementTxns.channel, channel),
        gte(marketplaceSettlementTxns.postedAt, from),
        lte(marketplaceSettlementTxns.postedAt, to),
      ))
      .groupBy(marketplaceSettlementTxns.orderId);
    for (const r of tRows) if (r.orderId) taxByOrder.set(r.orderId, { commissionTax: n(r.commissionTax), fbaFeeTax: n(r.fbaFeeTax) });
  }

  const byOrder = new Map<string, OrderPnl & { salesOrderId: string | null }>();
  for (const t of txns) {
    const key = t.externalOrderId ?? "";
    if (!key) continue;
    const row = byOrder.get(key) ?? {
      externalOrderId: key, orderNumber: t.orderNumber ?? null, postedAt: t.postedAt,
      status: t.status, deferred: false,
      sales: 0, refunds: 0, commission: 0, fbaFee: 0, otherFees: 0,
      commissionTax: 0, fbaFeeTax: 0,
      fees: 0, cogs: 0, net: 0, margin: 0, hasCogs: false, salesOrderId: t.salesOrderId,
    };
    // A refund is negative product sales; keeping it in its own column makes a
    // returned order legible instead of just a smaller sale.
    if (t.type === "Refund") row.refunds = round2(row.refunds + n(t.productSales));
    else row.sales = round2(row.sales + n(t.productSales));
    row.commission = round2(row.commission + n(t.sellingFees));
    row.fbaFee = round2(row.fbaFee + n(t.fbaFees));
    row.otherFees = round2(row.otherFees + n(t.otherTransactionFees));
    if (t.status === "Deferred") row.deferred = true;
    if (!row.orderNumber && t.orderNumber) row.orderNumber = t.orderNumber;
    if (!row.salesOrderId && t.salesOrderId) row.salesOrderId = t.salesOrderId;
    if (t.postedAt && (!row.postedAt || t.postedAt > row.postedAt)) row.postedAt = t.postedAt;
    byOrder.set(key, row);
  }

  return [...byOrder.values()].map((r) => {
    const cogs = r.salesOrderId ? (cogsByOrder.get(r.salesOrderId) ?? 0) : 0;
    const tax = taxByOrder.get(r.externalOrderId);
    // Fees are stored negative, exactly as Amazon reports them.
    const fees = round2(r.commission + r.fbaFee + r.otherFees);
    const revenue = round2(r.sales + r.refunds);
    const net = round2(revenue + fees - cogs);
    return {
      ...r, cogs, fees, net,
      commissionTax: tax?.commissionTax ?? 0, fbaFeeTax: tax?.fbaFeeTax ?? 0,
      margin: revenue > 0 ? (net / revenue) * 100 : 0,
      hasCogs: cogs !== 0,
    };
  }).sort((a, b) => (b.postedAt?.getTime() ?? 0) - (a.postedAt?.getTime() ?? 0));
}

/** Per-product: fees attributed per SKU, which the settlement report could never do. */
export async function getProductPnl(
  orgId: string, channel: string, platformId: string | null, from: Date, to: Date,
): Promise<ProductPnl[]> {
  const rows = await db.select({
    sku: marketplaceTxnItems.sku,
    asin: marketplaceTxnItems.asin,
    unitsSold: sql<string>`coalesce(sum(case when ${marketplaceSettlementTxns.type} <> 'Refund' then ${marketplaceTxnItems.quantity} else 0 end), 0)`,
    unitsRefunded: sql<string>`coalesce(sum(case when ${marketplaceSettlementTxns.type} = 'Refund' then ${marketplaceTxnItems.quantity} else 0 end), 0)`,
    sales: sql<string>`coalesce(sum(${marketplaceTxnItems.productCharges}), 0)`,
    commission: sql<string>`coalesce(sum(${marketplaceTxnItems.commission}), 0)`,
    fbaFee: sql<string>`coalesce(sum(${marketplaceTxnItems.fbaFee}), 0)`,
    otherFees: sql<string>`coalesce(sum(${marketplaceTxnItems.otherFees}), 0)`,
    commissionTax: sql<string>`coalesce(sum(${marketplaceTxnItems.commissionTax}), 0)`,
    fbaFeeTax: sql<string>`coalesce(sum(${marketplaceTxnItems.fbaFeeTax}), 0)`,
  })
    .from(marketplaceTxnItems)
    .innerJoin(marketplaceSettlementTxns, eq(marketplaceSettlementTxns.id, marketplaceTxnItems.txnId))
    .where(and(
      eq(marketplaceTxnItems.organizationId, orgId),
      eq(marketplaceSettlementTxns.channel, channel),
      // Ads charges, service fees and adjustments produce item rows with no product on
      // them. They are real money, and they are counted in the platform P&L — but they
      // are not a product, and listing them here as "unlinked item" told nobody anything.
      sql`coalesce(${marketplaceTxnItems.sku}, '') <> ''`,
      gte(marketplaceSettlementTxns.postedAt, from),
      lte(marketplaceSettlementTxns.postedAt, to),
    ))
    .groupBy(marketplaceTxnItems.sku, marketplaceTxnItems.asin);

  // SKU → item, through the normalized marketplace codes the importer already maintains.
  const skus = rows.map((r) => r.sku).filter((x): x is string => !!x);
  const itemBySku = new Map<string, { id: string; code: string | null; name: string | null }>();
  if (skus.length) {
    const norm = sql<string>`regexp_replace(upper(${itemCodes.code}), '[^A-Z0-9]', '', 'g')`;
    const codeRows = await db.select({ n: norm, id: items.id, code: items.code, name: items.nameAr })
      .from(itemCodes).innerJoin(items, eq(items.id, itemCodes.itemId))
      .where(eq(itemCodes.organizationId, orgId));
    const byNorm = new Map(codeRows.map((c) => [c.n, c]));
    for (const s of skus) {
      const hit = byNorm.get(s.toUpperCase().replace(/[^A-Z0-9]/g, ""));
      if (hit) itemBySku.set(s, { id: hit.id, code: hit.code, name: hit.name });
    }
  }

  // Cost per item, from this channel's deliveries only — an unscoped total would fold in
  // hand-entered sales and overstate what the marketplace cost.
  const itemIds = [...new Set([...itemBySku.values()].map((v) => v.id))];
  const cogsByItem = new Map<string, number>();
  if (itemIds.length) {
    const cRows = await db.select({ itemId: stockMovements.itemId, cogs: signedCost })
      .from(stockMovements)
      .innerJoin(deliveryNotes, and(eq(deliveryNotes.id, stockMovements.referenceId), eq(stockMovements.referenceType, "DELIVERY")))
      .innerJoin(salesOrders, eq(salesOrders.id, deliveryNotes.salesOrderId))
      .where(and(
        eq(stockMovements.organizationId, orgId),
        matchPlatform(channel, platformId),
        inArray(stockMovements.itemId, itemIds),
      ))
      .groupBy(stockMovements.itemId);
    for (const r of cRows) cogsByItem.set(r.itemId, n(r.cogs));
  }

  return rows.map((r) => {
    const it = r.sku ? itemBySku.get(r.sku) : undefined;
    const unitsSold = n(r.unitsSold), unitsRefunded = n(r.unitsRefunded);
    const units = unitsSold - unitsRefunded;
    const sales = round2(n(r.sales));
    const commission = round2(n(r.commission)), fbaFee = round2(n(r.fbaFee)), otherFees = round2(n(r.otherFees));
    const fees = round2(commission + fbaFee + otherFees);
    const cogs = it ? (cogsByItem.get(it.id) ?? 0) : 0;
    const net = round2(sales + fees - cogs);
    const unitSale = units > 0 ? round2(sales / units) : 0;
    const unitFees = units > 0 ? round2(-fees / units) : 0;   // shown positive: what a piece costs in fees
    const unitCost = units > 0 ? round2(cogs / units) : 0;
    return {
      sku: r.sku ?? "—", asin: r.asin, itemId: it?.id ?? null, code: it?.code ?? null, name: it?.name ?? null,
      units, unitsSold, unitsRefunded, sales, commission, fbaFee, otherFees, fees, cogs, net,
      commissionTax: round2(n(r.commissionTax)), fbaFeeTax: round2(n(r.fbaFeeTax)),
      margin: sales > 0 ? (net / sales) * 100 : 0,
      unitSale, unitFees, unitCost,
      // Below this a piece loses money once Amazon has taken its cut.
      breakEven: round2(unitCost + unitFees),
      hasCogs: cogs !== 0,
    };
  }).sort((a, b) => b.sales - a.sales);
}
