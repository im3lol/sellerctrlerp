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
) {
  return rows.map((r) => {
    const returned = returnsRevenueByItem.get(r.itemId) ?? 0;
    const revenue = round2(r.revenue - returned); // net of returns
    const cogs = cogsByItem.get(r.itemId) ?? 0;
    const profit = round2(revenue - cogs);
    return { code: r.code, name: r.name, qty: r.qty, revenue, cogs, profit, margin: revenue > 0 ? (profit / revenue) * 100 : 0 };
  });
}
