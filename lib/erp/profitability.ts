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
  // Per-UNIT estimated marketplace fees (referral + FBA) by itemId — optional;
  // absent map (or item) → 0 fees and netProfit === profit.
  feesPerUnitByItem?: Map<string, number>,
) {
  return rows.map((r) => {
    const returned = returnsRevenueByItem.get(r.itemId) ?? 0;
    const revenue = round2(r.revenue - returned); // net of returns
    const cogs = cogsByItem.get(r.itemId) ?? 0;
    const profit = round2(revenue - cogs);
    const fees = round2((feesPerUnitByItem?.get(r.itemId) ?? 0) * r.qty);
    const netProfit = round2(profit - fees);
    return {
      code: r.code, name: r.name, qty: r.qty, revenue, cogs, profit,
      margin: revenue > 0 ? (profit / revenue) * 100 : 0,
      fees, netProfit,
      netMargin: revenue > 0 ? (netProfit / revenue) * 100 : 0,
    };
  });
}
