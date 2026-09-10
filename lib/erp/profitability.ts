import { round2 } from "@/lib/erp/money";

// Per-item gross profit for the profitability report. Revenue must be netted by
// sales RETURNS the same way COGS already is (returned goods reverse cost via the
// SALES_RETURN stock movement) — otherwise every item with returns shows inflated
// profit by the full sale price of the returned units. Returns revenue counts only
// money returns (invoice-based, deliveryNoteId IS NULL); a delivery-only return
// restocks without ever booking revenue.

export type ProfitInput = { itemId: string; code: string | null; name: string | null; qty: number; revenue: number };

export function buildProfitability(
  rows: ProfitInput[],
  returnsRevenueByItem: Map<string, number>,
  cogsByItem: Map<string, number>,
  /**
   * TOTAL marketplace fees for the period by itemId — what Amazon actually deducted in
   * settlements, not a per-unit rate. This used to be documented as per-unit and was
   * multiplied by quantity, but every caller feeds it `getSettlementFeesByItem`, which
   * returns totals. An item that sold 4 units against 1,046.66 of real fees was reported
   * as having paid 4,186.64 — the product looked like a loss-maker on arithmetic alone.
   * Optional; absent map (or item) → 0 fees and netProfit === profit.
   */
  feesByItem?: Map<string, number>,
  /** Target margin % for the suggested price column. 0/absent → no suggestion. */
  targetMarginPct = 0,
) {
  return rows.map((r) => {
    const returned = returnsRevenueByItem.get(r.itemId) ?? 0;
    const revenue = round2(r.revenue - returned); // net of returns
    const cogs = cogsByItem.get(r.itemId) ?? 0;
    const profit = round2(revenue - cogs);
    const fees = round2(feesByItem?.get(r.itemId) ?? 0);
    const netProfit = round2(profit - fees);

    // Per-unit view: what a single piece actually earns and actually costs. `qty` is the
    // quantity sold in the period, so these are period averages, not a price list.
    const q = r.qty;
    const avgSellPrice = q > 0 ? round2(revenue / q) : 0;
    const unitCost = q > 0 ? round2(cogs / q) : 0;
    const unitFees = q > 0 ? round2(fees / q) : 0;
    // The price below which this product loses money once Amazon has taken its cut.
    const breakEven = round2(unitCost + unitFees);
    const gap = round2(avgSellPrice - breakEven);
    // What to charge for the margin the trader wants. Margin is on the SELLING price
    // (price − cost)/price, which is how a marketplace seller reads it; ≥100% has no
    // finite answer, so it yields nothing rather than a divide-by-zero.
    const suggested = targetMarginPct > 0 && targetMarginPct < 100
      ? round2(breakEven / (1 - targetMarginPct / 100))
      : 0;

    return {
      itemId: r.itemId, code: r.code, name: r.name, qty: q, revenue, cogs, profit,
      margin: revenue > 0 ? (profit / revenue) * 100 : 0,
      fees, netProfit,
      netMargin: revenue > 0 ? (netProfit / revenue) * 100 : 0,
      avgSellPrice, unitCost, unitFees, breakEven, gap, suggested,
    };
  });
}
