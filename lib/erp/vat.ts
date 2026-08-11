/**
 * Line VAT = the org's rate% applied to the taxable base (qty × price − discount).
 * Exempt lines, a zero rate, or a non-positive base all contribute 0. Derived — never
 * hand-typed — so hand-entry documents can't silently post with zero output/input VAT.
 * Shared by every document form + the create actions so the shown tax IS the posted tax.
 *
 * `vatRate` is a percentage (14 → 14%). Rounded to 2 decimals.
 */
export function lineVat(quantity: number, unitPrice: number, discountAmount: number, vatRate: number, exempt = false): number {
  if (exempt || !vatRate || vatRate <= 0) return 0;
  const base = (Number(quantity) || 0) * (Number(unitPrice) || 0) - (Number(discountAmount) || 0);
  if (base <= 0) return 0;
  return Math.round(base * vatRate) / 100; // base * (vatRate/100), 2dp
}
