/**
 * Landed-cost allocation: spread a total import charge (freight + customs +
 * insurance + …) across purchase-order lines, returning the shipping-cost PER
 * UNIT for each line (aligned by index). `eligible` lines share the cost; others
 * get 0. Three methods:
 *  - "value":  proportional to line value (quantity × unitPrice) — the common default.
 *  - "qty":    proportional to quantity → a uniform per-unit charge.
 *  - "weight": proportional to line weight (quantity × weight) — e.g. a price-per-kg
 *              freight cost, weighted by each item's own weight.
 * Pure + deterministic so it can be unit-tested; the PO form and the goods-receipt
 * form both call it to fill a `shippingPerUnit` column (order-level estimate vs.
 * this specific delivery's real cost — see the memory on per-receipt landed cost).
 */
export type LcLine = { quantity: number; unitPrice: number; weight?: number; eligible: boolean };

const round4 = (n: number) => Math.round(n * 10000) / 10000;

export function allocateLandedPerUnit(lines: LcLine[], total: number, method: "value" | "qty" | "weight"): number[] {
  if (!(total > 0)) return lines.map(() => 0);

  if (method === "value" || method === "weight") {
    const basis = (l: LcLine) => (method === "value" ? l.unitPrice : (l.weight ?? 0));
    const totBasis = lines.reduce((s, l) => s + (l.eligible && l.quantity > 0 ? l.quantity * basis(l) : 0), 0);
    if (!(totBasis > 0)) return lines.map(() => 0);
    return lines.map((l) => (l.eligible && l.quantity > 0 ? round4((total * ((l.quantity * basis(l)) / totBasis)) / l.quantity) : 0));
  }

  const totQty = lines.reduce((s, l) => s + (l.eligible && l.quantity > 0 ? l.quantity : 0), 0);
  if (!(totQty > 0)) return lines.map(() => 0);
  const per = round4(total / totQty);
  return lines.map((l) => (l.eligible && l.quantity > 0 ? per : 0));
}
