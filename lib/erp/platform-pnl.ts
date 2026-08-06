import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { salesInvoiceLines, salesInvoices, marketplaceSettlementTxns } from "@/db/schema";
import { liveInvoice } from "@/lib/erp/invoice-status";
import { cached, orgKey } from "@/lib/cache";

export type PlatformPnl = {
  units: number; revenue: number; cogs: number;
  referralFee: number; fbaFee: number; otherFee: number; fees: number;
  net: number; margin: number; hasSettlement: boolean;
};

/**
 * P&L for a whole marketplace: booked revenue/COGS/units from the platform's
 * auto-customer invoices + ACTUAL Amazon fees from its settlement transactions.
 * `net = revenue − cogs − fees`. Cached 60s per (org, channel, customer) — a dashboard
 * P&L doesn't need to recompute from raw SQL on every load; the key is tenant-scoped so
 * one org's figure can never be served to another.
 */
export async function getPlatformPnl(orgId: string, channel: string, customerId: string | null): Promise<PlatformPnl> {
  return cached(orgKey(orgId, "platform-pnl", channel, customerId), 60_000, () => computePlatformPnl(orgId, channel, customerId));
}

async function computePlatformPnl(orgId: string, channel: string, customerId: string | null): Promise<PlatformPnl> {
  const [sales] = customerId
    ? await db.select({
        units: sql<string>`coalesce(sum(${salesInvoiceLines.quantity}), 0)`,
        revenue: sql<string>`coalesce(sum(${salesInvoiceLines.totalAmount} - ${salesInvoiceLines.taxAmount}), 0)`,
        cogs: sql<string>`coalesce(sum(${salesInvoiceLines.costAmount}), 0)`,
      })
      .from(salesInvoiceLines)
      .innerJoin(salesInvoices, eq(salesInvoices.id, salesInvoiceLines.salesInvoiceId))
      .where(and(eq(salesInvoices.organizationId, orgId), eq(salesInvoices.customerId, customerId), liveInvoice(salesInvoices.status)))
    : [{ units: "0", revenue: "0", cogs: "0" }];

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
