import "server-only";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { stockMovements, deliveryNotes, salesOrders, salesReturns } from "@/db/schema";

/**
 * What sold goods actually cost — read from the stock ledger, which is the only place
 * that knows.
 *
 * `sales_invoice_lines.cost_amount` looks like the obvious source and both P&L engines
 * used it. Nothing in the codebase has ever written to that column: every row is 0, so
 * both engines reported a cost of zero and a profit equal to revenue (or, where revenue
 * was also broken, a "loss" that was just the sum of the marketplace fees). Cost is
 * posted by the DELIVERY, not the invoice — the delivery is what moves the goods — so it
 * comes from the movements the delivery wrote, at whatever FIFO/average cost applied at
 * the time. That is the same source the profitability report has always used.
 *
 * Sales returns reverse cost by moving stock back IN, so the sign convention is
 * OUT − IN; without that a returned item keeps its cost against revenue it no longer has.
 */
export const SALE_COGS_REFS = ["DELIVERY", "SALES_INVOICE", "SALES_RETURN"] as const;

/** OUT adds to cost of sales, IN (a return coming back) takes it away. */
const signedCost = sql<string>`coalesce(sum(case when ${stockMovements.type} = 'OUT' then ${stockMovements.totalCost} else -${stockMovements.totalCost} end), 0)`;

/** Cost of goods sold for one item, across every sales movement. */
export async function itemSalesCogs(orgId: string, itemId: string): Promise<number> {
  const [r] = await db.select({ cogs: signedCost })
    .from(stockMovements)
    .where(and(
      eq(stockMovements.organizationId, orgId),
      eq(stockMovements.itemId, itemId),
      inArray(stockMovements.referenceType, [...SALE_COGS_REFS]),
    ));
  return Number(r?.cogs ?? 0);
}

/**
 * Cost of goods sold for one marketplace.
 *
 * A movement carries no channel, so it has to be traced back to one: a delivery reaches
 * its order through `delivery_notes.sales_order_id`, and a return carries the channel
 * itself. Scoping matters — an unscoped total mixes in hand-entered sales and overstates
 * the platform's cost (here it pulled in 891.00 of MANUAL deliveries).
 */
export async function platformSalesCogs(orgId: string, channel: string, platformId: string | null): Promise<number> {
  const matchesPlatform = platformId
    ? or(eq(salesOrders.platformId, platformId), eq(salesOrders.channel, channel))
    : eq(salesOrders.channel, channel);

  const [delivered, returned] = await Promise.all([
    db.select({ cogs: signedCost })
      .from(stockMovements)
      .innerJoin(deliveryNotes, and(
        eq(deliveryNotes.id, stockMovements.referenceId),
        eq(stockMovements.referenceType, "DELIVERY"),
      ))
      .innerJoin(salesOrders, eq(salesOrders.id, deliveryNotes.salesOrderId))
      .where(and(eq(stockMovements.organizationId, orgId), matchesPlatform)),
    db.select({ cogs: signedCost })
      .from(stockMovements)
      .innerJoin(salesReturns, and(
        eq(salesReturns.id, stockMovements.referenceId),
        eq(stockMovements.referenceType, "SALES_RETURN"),
      ))
      .where(and(
        eq(stockMovements.organizationId, orgId),
        eq(salesReturns.channel, channel),
      )),
  ]);
  return Number(delivered[0]?.cogs ?? 0) + Number(returned[0]?.cogs ?? 0);
}
