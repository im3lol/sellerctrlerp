/**
 * Supplier scorecard, computed from documents the business already files — no new data
 * entry, no questionnaire, nothing to keep up to date. Three things a buyer actually
 * argues about:
 *
 *   التزام المواعيد  delivery date on the order vs the date the goods were received
 *   الجودة           rejected quantity at receipt vs everything that arrived
 *   الالتزام بالسعر  invoiced price vs the price agreed on the order
 *
 * Read-only by design: it ranks suppliers, it never blocks one. A score is an argument
 * for a conversation, not a gate — and a supplier with two receipts has no score worth
 * acting on, which is why `sample` travels with every number.
 *
 * Pure — no db — so the weighting can be argued with in a test rather than in production.
 */

export type ReceiptFact = {
  supplierId: string;
  /** Promised on the purchase order. Null when the order carried no date. */
  expectedDate?: string | Date | null;
  receivedDate: string | Date;
  acceptedQty: number;
  rejectedQty: number;
};

export type PriceFact = {
  supplierId: string;
  orderedUnitPrice: number;
  invoicedUnitPrice: number;
  quantity: number;
};

export type SupplierScore = {
  supplierId: string;
  /** 0-100, or null when there is nothing to measure. */
  onTime: number | null;
  quality: number | null;
  priceHonesty: number | null;
  /** Weighted 0-100 across whichever of the three could be measured. */
  overall: number | null;
  /** What the score is built on, so a two-receipt supplier isn't read as gospel. */
  sample: { receipts: number; datedReceipts: number; invoicedLines: number };
  /** Average days late (negative = early). Null when no receipt carried a promised date. */
  avgDaysLate: number | null;
  /** Share of arrived quantity that was rejected, 0-1. */
  rejectRate: number | null;
  /** Average overcharge as a share of the agreed price, 0-1 (0 when never overcharged). */
  overchargeRate: number | null;
};

const DAY = 86_400_000;
const clamp = (n: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, n));
const r1 = (n: number) => Math.round(n * 10) / 10;

const asTime = (v: string | Date | null | undefined): number | null => {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
};

/**
 * Lateness → score. On time or early is 100; each day late costs 5 points, so a week
 * late lands at 65 and a month is 0. Linear on purpose: a curve here would be a guess
 * dressed up as precision.
 */
export function onTimeScore(avgDaysLate: number): number {
  return clamp(100 - Math.max(0, avgDaysLate) * 5);
}

/** Rejects → score. 0 rejects is 100; 20% rejected is 0. */
export function qualityScore(rejectRate: number): number {
  return clamp(100 - rejectRate * 500);
}

/** Overcharge → score. Invoicing the agreed price is 100; 10% over is 0. */
export function priceScore(overchargeRate: number): number {
  return clamp(100 - overchargeRate * 1000);
}

/**
 * Score every supplier appearing in the facts. Weights: 40 delivery, 35 quality,
 * 25 price — late goods stop a business, a bad price only costs it. A dimension with no
 * data is dropped and the rest are re-weighted, rather than scored as zero: never having
 * been invoiced is not the same as overcharging.
 */
export function scoreSuppliers(receipts: ReceiptFact[], prices: PriceFact[]): SupplierScore[] {
  const ids = new Set([...receipts.map((r) => r.supplierId), ...prices.map((p) => p.supplierId)]);
  const out: SupplierScore[] = [];

  for (const supplierId of ids) {
    const rs = receipts.filter((r) => r.supplierId === supplierId);
    const ps = prices.filter((p) => p.supplierId === supplierId);

    // ── delivery ──────────────────────────────────────────────
    const dated = rs
      .map((r) => ({ exp: asTime(r.expectedDate), got: asTime(r.receivedDate) }))
      .filter((x): x is { exp: number; got: number } => x.exp != null && x.got != null);
    const avgDaysLate = dated.length
      ? dated.reduce((s, x) => s + (x.got - x.exp) / DAY, 0) / dated.length
      : null;
    const onTime = avgDaysLate == null ? null : onTimeScore(avgDaysLate);

    // ── quality ───────────────────────────────────────────────
    const arrived = rs.reduce((s, r) => s + Number(r.acceptedQty) + Number(r.rejectedQty), 0);
    const rejected = rs.reduce((s, r) => s + Number(r.rejectedQty), 0);
    const rejectRate = arrived > 0 ? rejected / arrived : null;
    const quality = rejectRate == null ? null : qualityScore(rejectRate);

    // ── price ─────────────────────────────────────────────────
    // Weighted by quantity: overcharging on a pallet matters more than on one box.
    // Undercharging is not a virtue to be rewarded — it floors at zero, not negative.
    const priceQty = ps.reduce((s, p) => s + Number(p.quantity), 0);
    const overcharge = priceQty > 0
      ? ps.reduce((s, p) => {
          const agreed = Number(p.orderedUnitPrice);
          if (!(agreed > 0)) return s;
          const over = Math.max(0, Number(p.invoicedUnitPrice) - agreed) / agreed;
          return s + over * Number(p.quantity);
        }, 0) / priceQty
      : null;
    const priceHonesty = overcharge == null ? null : priceScore(overcharge);

    // ── overall ───────────────────────────────────────────────
    const parts: [number | null, number][] = [[onTime, 40], [quality, 35], [priceHonesty, 25]];
    const present = parts.filter((p): p is [number, number] => p[0] != null);
    const weight = present.reduce((s, [, w]) => s + w, 0);
    const overall = weight > 0 ? r1(present.reduce((s, [v, w]) => s + v * w, 0) / weight) : null;

    out.push({
      supplierId,
      onTime: onTime == null ? null : r1(onTime),
      quality: quality == null ? null : r1(quality),
      priceHonesty: priceHonesty == null ? null : r1(priceHonesty),
      overall,
      sample: { receipts: rs.length, datedReceipts: dated.length, invoicedLines: ps.length },
      avgDaysLate: avgDaysLate == null ? null : r1(avgDaysLate),
      rejectRate: rejectRate == null ? null : Math.round(rejectRate * 1000) / 1000,
      overchargeRate: overcharge == null ? null : Math.round(overcharge * 1000) / 1000,
    });
  }

  // Best first; an unscored supplier sits at the bottom rather than at the top.
  return out.sort((a, b) => (b.overall ?? -1) - (a.overall ?? -1));
}

/** A one-word verdict, and null while the sample is too thin to deserve one. */
export function ratingLabel(s: SupplierScore): "ممتاز" | "جيد" | "مقبول" | "ضعيف" | null {
  if (s.overall == null || s.sample.receipts < 3) return null;
  if (s.overall >= 90) return "ممتاز";
  if (s.overall >= 75) return "جيد";
  if (s.overall >= 55) return "مقبول";
  return "ضعيف";
}
