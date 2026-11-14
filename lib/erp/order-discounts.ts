/** Preserve header-only marketplace discounts when converting an order to invoices.
 * Existing line discounts are retained; undistributed cents are allocated by net
 * goods value, with deterministic largest remainders. No tax is recomputed here:
 * marketplace tax is an authoritative snapshot of the original transaction.
 */
export function effectiveOrderDiscounts(header: number, lines: {
  quantity: number; unitPrice: number; discountAmount: number;
}[]): number[] {
  const existing = lines.map(l => Math.round(l.discountAmount * 100));
  const remainder = Math.round(header * 100) - existing.reduce((a, b) => a + b, 0);
  if (remainder === 0) return existing.map(v => v / 100);
  if (remainder < 0) throw new Error("خصم أمر البيع أقل من مجموع خصومات بنوده — راجع المستند قبل الفوترة");
  const weights = lines.map((l, i) => Math.max(0, Math.round(l.quantity * l.unitPrice * 100) - existing[i]));
  const total = weights.reduce((a, b) => a + b, 0);
  if (total < remainder || total === 0) throw new Error("خصم أمر البيع أكبر من قيمة البنود المتاحة");
  const shares = weights.map(w => Math.floor(remainder * w / total));
  const ranked = weights.map((w, i) => ({ i, residual: remainder * w / total - shares[i] }))
    .sort((a, b) => b.residual - a.residual || a.i - b.i);
  const centsLeft = remainder - shares.reduce((a, b) => a + b, 0);
  for (let i = 0; i < centsLeft; i++) shares[ranked[i].i]++;
  return existing.map((v, i) => (v + shares[i]) / 100);
}
