import "server-only";
import { and, eq, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { salesInvoiceLines, salesInvoices, salesOrders, marketplaceSettlementTxns } from "@/db/schema";
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
  // Invoices carry no channel of their own — scope through their originating order,
  // which does (platformId OR channel). innerJoin drops non-marketplace invoices, which
  // is correct: only this platform's order-invoices count toward its P&L.
  const [sales] = await db.select({
      units: sql<string>`coalesce(sum(${salesInvoiceLines.quantity}), 0)`,
      revenue: sql<string>`coalesce(sum(${salesInvoiceLines.totalAmount} - ${salesInvoiceLines.taxAmount}), 0)`,
      cogs: sql<string>`coalesce(sum(${salesInvoiceLines.costAmount}), 0)`,
    })
    .from(salesInvoiceLines)
    .innerJoin(salesInvoices, eq(salesInvoices.id, salesInvoiceLines.salesInvoiceId))
    .innerJoin(salesOrders, eq(salesOrders.id, salesInvoices.salesOrderId))
    .where(and(
      eq(salesInvoices.organizationId, orgId),
      platformId ? or(eq(salesOrders.platformId, platformId), eq(salesOrders.channel, channel)) : eq(salesOrders.channel, channel),
      liveInvoice(salesInvoices.status),
    ));

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

  const revenue = Number(sales?.revenue ?? 0);
  const cogs = Number(sales?.cogs ?? 0);
  const referralFee = Number(fees?.referral ?? 0);
  const fbaFee = Number(fees?.fba ?? 0);
  const otherFee = Number(fees?.other ?? 0);
  const feeTotal = referralFee + fbaFee + otherFee;
  const net = revenue - cogs - feeTotal;
  return {
    units: Number(sales?.units ?? 0), revenue, cogs, referralFee, fbaFee, otherFee, fees: feeTotal,
    net, margin: revenue > 0 ? (net / revenue) * 100 : 0,
    hasSettlement: Number(fees?.n ?? 0) > 0,
  };
}
