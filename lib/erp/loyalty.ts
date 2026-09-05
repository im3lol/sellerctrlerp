/**
 * Loyalty points. A point is a promise to give a discount later, so the arithmetic is
 * kept in one pure place and the balance is always a sum of the ledger — never a number
 * someone can nudge.
 *
 * ponytail: redemption comes off the sale as a discount, not as a booked liability. That
 * matches how an SME retailer thinks about it and needs no new accounts. If an auditor
 * ever wants the outstanding points on the balance sheet, the ledger here already holds
 * everything a deferred-revenue posting would need.
 */

export type LoyaltyProgram = {
  /** Points earned per pound spent. 0 turns the programme off. */
  earnRate: number;
  /** Pounds a point is worth when redeemed. */
  redeemRate: number;
  /** No redeeming until the customer has at least this many. */
  minRedeem: number;
};

export const OFF: LoyaltyProgram = { earnRate: 0, redeemRate: 0, minRedeem: 0 };

/** Points earned on a sale. Whole points only — half a point is not a thing anyone wants. */
export function earnedPoints(netTotal: number, program: LoyaltyProgram): number {
  if (program.earnRate <= 0 || netTotal <= 0) return 0;
  return Math.floor(netTotal * program.earnRate);
}

export const pointsValue = (points: number, program: LoyaltyProgram): number =>
  Math.round(points * program.redeemRate * 100) / 100;

/**
 * The most a customer may take off this sale: never more than they have, and never more
 * than the sale is worth — points do not become cash back.
 */
export function maxRedeemable(balance: number, saleTotal: number, program: LoyaltyProgram): number {
  if (program.redeemRate <= 0 || balance < program.minRedeem) return 0;
  const affordable = Math.floor(saleTotal / program.redeemRate);
  return Math.max(0, Math.min(balance, affordable));
}

/** Returns the reason a redemption is refused, or null when it is fine. */
export function validateRedeem(
  points: number,
  balance: number,
  saleTotal: number,
  program: LoyaltyProgram,
): string | null {
  if (points <= 0) return "عدد النقط لازم يكون أكبر من صفر";
  if (!Number.isInteger(points)) return "النقط أرقام صحيحة";
  if (program.redeemRate <= 0) return "برنامج النقط مش مفعّل";
  if (balance < program.minRedeem) return `الاستبدال بيبدأ من ${program.minRedeem} نقطة`;
  if (points > balance) return `رصيد العميل ${balance} نقطة بس`;
  if (pointsValue(points, program) > saleTotal) return "النقط أكبر من قيمة الفاتورة — النقط مبتترجعش كاش";
  return null;
}

/** A balance is what the ledger says it is. */
export const pointsBalance = (entries: { points: number }[]): number =>
  entries.reduce((s, e) => s + e.points, 0);
