import { round2 as r2 } from "@/lib/erp/money";
import { nonOrderFeeCategory, type FeeCatKey } from "@/lib/erp/settlement-fees";

/**
 * Pure GL math for Amazon settlement posting (no DB / server imports, so it stays
 * unit-testable). A settlement posts ONE journal entry PER matched order (traceable,
 * so a later refund/reimbursement stays attributable to its order) + ONE aggregated
 * entry for everything not tied to an order (ads, service fees, FBA inventory fees,
 * SAFE-T, bank transfers). Orders NOT imported into the system are HELD — never
 * touching AR — until their sales order exists.
 */

export type SettleAmounts = {
  type: string; productSales: number; shippingCredits: number; promotionalRebates: number;
  sellingFees: number; fbaFees: number; otherTransactionFees: number; other: number; total: number;
};

/** Customer proceeds for an order row (credited against the order's AR). */
export function orderReceivable(t: SettleAmounts): number {
  return t.productSales + t.shippingCredits + t.promotionalRebates + t.other;
}
/** Amazon's cut for an order row (referral + FBA + other) as a positive expense. */
export function orderFees(t: SettleAmounts): number {
  return -(t.sellingFees + t.fbaFees + t.otherTransactionFees);
}

/**
 * Split released rows into: order groups (Order rows keyed by salesOrderId — one
 * per-order entry each), held order rows (Order rows with no imported sales order —
 * NOT posted, so AR is never touched for un-imported orders), non-order rows
 * (everything else — one aggregated entry), and refund rows (owned by the return
 * cycle; folding them into AR here would double-count the credit note's reversal).
 */
export function splitSettlementRows<T extends { type: string; salesOrderId?: string | null }>(rows: T[]): {
  orderGroups: Map<string, T[]>; heldOrderRows: T[]; nonOrderRows: T[]; refundRows: T[];
} {
  const orderGroups = new Map<string, T[]>();
  const heldOrderRows: T[] = [];
  const nonOrderRows: T[] = [];
  const refundRows: T[] = [];
  for (const r of rows) {
    if (r.type === "Refund") refundRows.push(r);
    else if (r.type === "Order") {
      if (r.salesOrderId) { const g = orderGroups.get(r.salesOrderId) ?? []; g.push(r); orderGroups.set(r.salesOrderId, g); }
      else heldOrderRows.push(r);
    } else nonOrderRows.push(r);
  }
  return { orderGroups, heldOrderRows, nonOrderRows, refundRows };
}

/** GL movements for one order's rows: Cr receivable = Dr clearing + Dr fees. */
export function perOrderGL(rows: SettleAmounts[]): { receivable: number; fees: number; clearing: number } {
  let receivable = 0, fees = 0, clearing = 0;
  for (const t of rows) { receivable += orderReceivable(t); fees += orderFees(t); clearing += t.total; }
  return { receivable: r2(receivable), fees: r2(fees), clearing: r2(clearing) };
}

/** Per-category EXPENSE split for one order's rows (positive magnitudes): the order fee
 *  buckets map directly — sellingFees→referral, fbaFees→fba, otherTransactionFees→other_txn.
 *  Sums to orderFees(); the settlement posting routes each to its GL sub-account and lets
 *  a residual line absorb any rounding so the entry still balances. */
export function perOrderFeesByCat(rows: SettleAmounts[]): Partial<Record<FeeCatKey, number>> {
  let referral = 0, fba = 0, otherTxn = 0;
  for (const t of rows) { referral -= t.sellingFees; fba -= t.fbaFees; otherTxn -= t.otherTransactionFees; }
  return { referral: r2(referral), fba: r2(fba), other_txn: r2(otherTxn) };
}

/** Per-category split for non-order rows (needs type+description to classify — ads, storage,
 *  subscription, reimbursement, other). Expense categories are positive; a reimbursement row
 *  nets negative (income offset). Transfer rows excluded (they're bank movement, not a fee). */
export function nonOrderFeesByCat(rows: { type: string; description?: string | null; total: number }[]): Partial<Record<FeeCatKey, number>> {
  const acc: Partial<Record<FeeCatKey, number>> = {};
  for (const r of rows) {
    if (r.type === "Transfer") continue;
    const k = nonOrderFeeCategory(r.type, r.description ?? "");
    acc[k] = r2((acc[k] ?? 0) - r.total);
  }
  return acc;
}

/** Aggregated GL for non-order rows (service/ads/FBA-inventory/SAFE-T + transfers). */
export function nonOrderGL(rows: SettleAmounts[]): { fees: number; bank: number; clearing: number } {
  let fees = 0, bank = 0, clearing = 0;
  for (const t of rows) {
    clearing += t.total;
    if (t.type === "Transfer") bank += -t.total;
    else fees += -t.total;
  }
  return { fees: r2(fees), bank: r2(bank), clearing: r2(clearing) };
}
