/**
 * Landed-cost allocation: spread a total import charge (freight + customs +
 * insurance + …) across purchase-order lines, returning the shipping-cost PER
 * UNIT for each line (aligned by index). `eligible` lines share the cost; others
 * get 0. Two methods:
 *  - "value": proportional to line value (quantity × unitPrice) — the common default.
 *  - "qty":   proportional to quantity → a uniform per-unit charge.
 * Pure + deterministic so it can be unit-tested; the PO form calls it to fill the
 * existing `shippingPerUnit` column, which the goods-receipt engine capitalises.
 */
export type LcLine = { quantity: number; unitPrice: number; eligible: boolean };

const round4 = (n: number) => Math.round(n * 10000) / 10000;

export function allocateLandedPerUnit(lines: LcLine[], total: number, method: "value" | "qty"): number[] {
  if (!(total > 0)) return lines.map(() => 0);

  if (method === "value") {
    const totVal = lines.reduce((s, l) => s + (l.eligible && l.quantity > 0 ? l.quantity * l.unitPrice : 0), 0);
    if (!(totVal > 0)) return lines.map(() => 0);
    return lines.map((l) => (l.eligible && l.quantity > 0 ? round4((total * ((l.quantity * l.unitPrice) / totVal)) / l.quantity) : 0));
  }

  const totQty = lines.reduce((s, l) => s + (l.eligible && l.quantity > 0 ? l.quantity : 0), 0);
  if (!(totQty > 0)) return lines.map(() => 0);
  const per = round4(total / totQty);
  return lines.map((l) => (l.eligible && l.quantity > 0 ? per : 0));
}
