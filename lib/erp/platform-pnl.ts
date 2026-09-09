import "server-only";
import { and, eq, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { salesInvoiceLines, salesInvoices, salesOrders, deliveryNotes, marketplaceSettlementTxns } from "@/db/schema";
import { platformSalesCogs } from "@/lib/erp/sales-cogs";
import { liveInvoice } from "@/lib/erp/invoice-status";
import { cached, orgKey } from "@/lib/cache";

export type PlatformPnl = {
  units: number; revenue: number; cogs: number;
  referralFee: number; fbaFee: number; otherFee: number; fees: number;
  net: number; margin: number; hasSettlement: boolean;
};

/**
 * P&L for a whole marketplace: booked revenue/COGS/units from THIS platform's own
 * invoices + ACTUAL Amazon fees from its settlement transactions. Revenue/COGS are
 * scoped by the platform itself (platformId OR channel), NOT by the customer — two
 * platforms can share an auto-customer and would otherwise bleed into each other.
 * `net = revenue − cogs − fees`. Cached 60s per (org, channel, platform); tenant-scoped.
 */
export async function getPlatformPnl(orgId: string, channel: string, platformId: string | null): Promise<PlatformPnl> {
  return cached(orgKey(orgId, "platform-pnl", channel, platformId), 60_000, () => computePlatformPnl(orgId, channel, platformId));
}

async function computePlatformPnl(orgId: string, channel: string, platformId: string | null): Promise<PlatformPnl> {
  // Invoices carry no channel of their own, so they're scoped through their originating
  // order. Reaching it via `salesInvoices.salesOrderId` alone matched NOTHING: in the
  // marketplace cycle the invoice is raised from the delivery note, and that column is
  // null on every row (17 of 17 here). Revenue and units read as zero, so the card showed
  // a "loss" that was nothing but the sum of Amazon's fees. The order is reachable either
  // directly or through the delivery note, so accept both.
  const [sales, cogs] = await Promise.all([
    db.select({
        units: sql<string>`coalesce(sum(${salesInvoiceLines.quantity}), 0)`,
        revenue: sql<string>`coalesce(sum(${salesInvoiceLines.totalAmount} - ${salesInvoiceLines.taxAmount}), 0)`,
      })
      .from(salesInvoiceLines)
      .innerJoin(salesInvoices, eq(salesInvoices.id, salesInvoiceLines.salesInvoiceId))
      .leftJoin(deliveryNotes, eq(deliveryNotes.id, salesInvoices.deliveryNoteId))
      .innerJoin(salesOrders, or(
        eq(salesOrders.id, salesInvoices.salesOrderId),
        eq(salesOrders.id, deliveryNotes.salesOrderId),
      ))
      .where(and(
        eq(salesInvoices.organizationId, orgId),
        platformId ? or(eq(salesOrders.platformId, platformId), eq(salesOrders.channel, channel)) : eq(salesOrders.channel, channel),
        liveInvoice(salesInvoices.status),
      )),
    // Cost comes from the stock ledger, not from the invoice line: nothing writes
    // `cost_amount`, so summing it always produced 0. See lib/erp/sales-cogs.ts.
    platformSalesCogs(orgId, channel, platformId),
  ]);

  const [fees] = await db.select({
    referral: sql<string>`coalesce(-sum(${marketplaceSettlementTxns.sellingFees}), 0)`,
    fba: sql<string>`coalesce(-sum(${marketplaceSettlementTxns.fbaFees}), 0)`,
    other: sql<string>`coalesce(-sum(${marketplaceSettlementTxns.otherTransactionFees}), 0)`,
    n: sql<string>`count(*)`,
  }).from(marketplaceSettlementTxns).where(and(
    eq(marketplaceSettlementTxns.organizationId, orgId),
    eq(marketplaceSettlementTxns.channel, channel),
    eq(marketplaceSettlementTxns.type, "Order"),
  ));

  const revenue = Number(sales[0]?.revenue ?? 0);
  const referralFee = Number(fees?.referral ?? 0);
  const fbaFee = Number(fees?.fba ?? 0);
  const otherFee = Number(fees?.other ?? 0);
  const feeTotal = referralFee + fbaFee + otherFee;
  const net = revenue - cogs - feeTotal;
  return {
    units: Number(sales[0]?.units ?? 0), revenue, cogs, referralFee, fbaFee, otherFee, fees: feeTotal,
    net, margin: revenue > 0 ? (net / revenue) * 100 : 0,
    hasSettlement: Number(fees?.n ?? 0) > 0,
  };
}
