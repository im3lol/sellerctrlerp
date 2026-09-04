/**
 * Quote comparison. Several suppliers priced the same basket; the buyer has to pick one
 * and be able to say why. This turns the answers into a matrix and marks the best number
 * in each column — it does not pretend to make the decision.
 *
 * The one thing it insists on is honesty about gaps. A supplier who quoted three of five
 * lines usually shows the lowest total, and ranking on that total would recommend them
 * every time. So a partial quote is flagged, ranked below every complete one, and its
 * total is labelled as covering only part of the basket.
 *
 * Pure — no db — so the ranking can be argued with in a test.
 */

export type RfqLine = { id: string; itemId: string; quantity: number };
export type QuoteSupplier = {
  id: string;
  supplierId: string;
  supplierName: string;
  status: "INVITED" | "QUOTED" | "DECLINED";
  leadDays?: number | null;
  paymentTermDays?: number | null;
};
export type QuotePrice = { rfqSupplierId: string; rfqLineId: string; unitPrice: number };

export type ComparedSupplier = {
  id: string;
  supplierId: string;
  supplierName: string;
  status: QuoteSupplier["status"];
  leadDays: number | null;
  paymentTermDays: number | null;
  /** Price per RFQ line id; missing when they did not quote that line. */
  prices: Record<string, number | null>;
  /** Line totals (price × quantity) for the lines they did quote. */
  total: number;
  quotedLines: number;
  /** True when every line in the basket has a price. */
  complete: boolean;
  /** Rank among suppliers; complete quotes first, then by total. Null when not quoted. */
  rank: number | null;
};

export type Comparison = {
  suppliers: ComparedSupplier[];
  /** Cheapest unit price per line, and who offered it. */
  bestPerLine: Record<string, { rfqSupplierId: string; unitPrice: number } | null>;
  /** The complete quote with the lowest total, when there is one. */
  recommendedId: string | null;
  /** What the basket costs taking each line from whoever is cheapest on it. */
  bestOfBreedTotal: number | null;
  /** Saving of the recommended quote against the most expensive complete one. */
  spread: number | null;
};

const round2 = (n: number) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/**
 * Build the comparison. `bestOfBreedTotal` is what the basket would cost split across
 * suppliers — usually not what anyone does, but it is the number that shows whether one
 * supplier is genuinely cheapest or just cheapest on average.
 */
export function compareQuotes(
  lines: RfqLine[],
  suppliers: QuoteSupplier[],
  prices: QuotePrice[],
): Comparison {
  const qtyByLine = new Map(lines.map((l) => [l.id, Number(l.quantity) || 0]));

  const compared: ComparedSupplier[] = suppliers.map((s) => {
    const own = prices.filter((p) => p.rfqSupplierId === s.id);
    const byLine = new Map(own.map((p) => [p.rfqLineId, Number(p.unitPrice)]));

    const priceMap: Record<string, number | null> = {};
    let total = 0;
    let quotedLines = 0;
    for (const l of lines) {
      const price = byLine.has(l.id) ? byLine.get(l.id)! : null;
      priceMap[l.id] = price;
      if (price != null) {
        total += price * (qtyByLine.get(l.id) ?? 0);
        quotedLines++;
      }
    }

    return {
      id: s.id, supplierId: s.supplierId, supplierName: s.supplierName, status: s.status,
      leadDays: s.leadDays ?? null,
      paymentTermDays: s.paymentTermDays ?? null,
      prices: priceMap,
      total: round2(total),
      quotedLines,
      complete: lines.length > 0 && quotedLines === lines.length,
      rank: null,
    };
  });

  // Rank: complete quotes first (cheapest first), then partial ones, then no quote.
  const quoted = compared.filter((c) => c.quotedLines > 0);
  quoted
    .sort((a, b) => {
      if (a.complete !== b.complete) return a.complete ? -1 : 1;
      if (a.total !== b.total) return a.total - b.total;
      // Same money: the one who delivers sooner wins; unknown lead time sorts last.
      return (a.leadDays ?? Number.POSITIVE_INFINITY) - (b.leadDays ?? Number.POSITIVE_INFINITY);
    })
    .forEach((c, i) => { c.rank = i + 1; });

  const bestPerLine: Comparison["bestPerLine"] = {};
  let bestOfBreed = 0;
  let everyLineCovered = lines.length > 0;
  for (const l of lines) {
    let best: { rfqSupplierId: string; unitPrice: number } | null = null;
    for (const c of compared) {
      const p = c.prices[l.id];
      if (p == null) continue;
      if (!best || p < best.unitPrice) best = { rfqSupplierId: c.id, unitPrice: p };
    }
    bestPerLine[l.id] = best;
    if (best) bestOfBreed += best.unitPrice * (qtyByLine.get(l.id) ?? 0);
    else everyLineCovered = false;
  }

  const completes = compared.filter((c) => c.complete);
  const recommended = completes.length
    ? completes.reduce((a, b) => (b.total < a.total ? b : a))
    : null;
  const dearest = completes.length
    ? completes.reduce((a, b) => (b.total > a.total ? b : a))
    : null;

  return {
    suppliers: compared,
    bestPerLine,
    recommendedId: recommended?.id ?? null,
    bestOfBreedTotal: everyLineCovered ? round2(bestOfBreed) : null,
    spread: recommended && dearest ? round2(dearest.total - recommended.total) : null,
  };
}

/** Whether an RFQ has enough to compare: at least one line and one answer. */
export function canCompare(lines: RfqLine[], prices: QuotePrice[]): boolean {
  return lines.length > 0 && prices.length > 0;
}

/**
 * Validate an RFQ before it goes out. Returns an Arabic error or null. Sending a request
 * with no suppliers or no items is a wasted round trip with every supplier on the list.
 */
export function validateRfq(input: { lines: { itemId: string; quantity: number }[]; supplierIds: string[] }): string | null {
  if (!input.lines.length) return "أضف صنفاً واحداً على الأقل";
  if (input.lines.some((l) => !l.itemId)) return "اختر الصنف في كل سطر";
  if (input.lines.some((l) => !(Number(l.quantity) > 0))) return "الكمية لازم تكون أكبر من صفر";
  const items = new Set<string>();
  for (const l of input.lines) {
    if (items.has(l.itemId)) return "الصنف مكرّر — اجمعه في سطر واحد";
    items.add(l.itemId);
  }
  if (!input.supplierIds.length) return "اختر مورّداً واحداً على الأقل";
  if (new Set(input.supplierIds).size !== input.supplierIds.length) return "المورّد مكرّر";
  return null;
}
