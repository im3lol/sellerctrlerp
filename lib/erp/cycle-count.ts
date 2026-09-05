/**
 * Cycle counting: count a slice of the warehouse every week rather than shutting the
 * whole place for a day once a year. Two questions, both pure and both testable —
 * which items go on this week's sheet, and what the count found.
 *
 * The differences become an ordinary stock adjustment. Nothing here posts.
 */

export type Candidate = {
  itemId: string;
  /** On-hand × unit cost — what an error on this item is worth. */
  value: number;
  /** Movements in the recent window — how often an error can creep in. */
  movements: number;
  /** When it was last counted, so nothing is counted twice while something waits forever. */
  lastCountedAt?: string | Date | null;
};

export type SelectionMethod = "VALUE" | "MOVEMENT" | "MANUAL";

export type CountLine = {
  itemId: string;
  systemQty: number;
  countedQty: number | null;
  unitCost: number;
};

export type Variance = {
  itemId: string;
  systemQty: number;
  countedQty: number;
  /** counted − system: positive is a surplus, negative a shortage. */
  difference: number;
  valueImpact: number;
};

const round2 = (n: number) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const EPS = 1e-9;

const ts = (v: string | Date | null | undefined): number =>
  v == null ? 0 : (v instanceof Date ? v : new Date(v)).getTime() || 0;

/**
 * Which items this cycle covers.
 *
 * The ranking is by exposure — value, or how often the item moves — but the tiebreak is
 * always "longest since counted". Ranking on value alone counts the same expensive items
 * every week and never reaches the rest, which is how the slow-moving corner of the
 * warehouse ends up years out of date.
 */
export function selectForCycle(
  candidates: Candidate[],
  method: SelectionMethod,
  limit: number,
): Candidate[] {
  const n = Math.max(0, Math.floor(limit));
  if (!n) return [];

  const score = (c: Candidate) =>
    method === "MOVEMENT" ? Number(c.movements) || 0 : Number(c.value) || 0;

  return [...candidates]
    .sort((a, b) => {
      // Never counted comes first however small it is — an uncounted item is the one
      // nobody can vouch for.
      const la = ts(a.lastCountedAt);
      const lb = ts(b.lastCountedAt);
      if ((la === 0) !== (lb === 0)) return la === 0 ? -1 : 1;
      const s = score(b) - score(a);
      if (Math.abs(s) > EPS) return s;
      return la - lb; // longest since counted wins the tie
    })
    .slice(0, n);
}

/** The differences a count found — only the lines that actually disagree. */
export function variances(lines: CountLine[]): Variance[] {
  return lines
    .filter((l) => l.countedQty != null && Math.abs(Number(l.countedQty) - Number(l.systemQty)) > EPS)
    .map((l) => {
      const counted = Number(l.countedQty);
      const system = Number(l.systemQty);
      const difference = round2(counted - system);
      return {
        itemId: l.itemId,
        systemQty: system,
        countedQty: counted,
        difference,
        valueImpact: round2(difference * (Number(l.unitCost) || 0)),
      };
    });
}

/**
 * How the count went. `accuracy` is the share of counted lines that matched exactly —
 * the number worth tracking over time, because it says whether the warehouse is getting
 * better or worse rather than what one week's errors cost.
 */
export function countSummary(lines: CountLine[]) {
  const counted = lines.filter((l) => l.countedQty != null);
  const diffs = variances(lines);
  const surplus = diffs.filter((d) => d.difference > 0);
  const shortage = diffs.filter((d) => d.difference < 0);
  return {
    total: lines.length,
    counted: counted.length,
    pending: lines.length - counted.length,
    matched: counted.length - diffs.length,
    accuracy: counted.length ? Math.round(((counted.length - diffs.length) / counted.length) * 1000) / 10 : null,
    surplusValue: round2(surplus.reduce((s, d) => s + d.valueImpact, 0)),
    shortageValue: round2(shortage.reduce((s, d) => s + d.valueImpact, 0)),
    netValue: round2(diffs.reduce((s, d) => s + d.valueImpact, 0)),
  };
}

/**
 * Whether the sheet can be posted. A half-counted sheet posted as-is would treat every
 * uncounted line as agreeing with the book, which is a claim nobody made.
 */
export function canPost(lines: CountLine[]): string | null {
  if (!lines.length) return "الجرد فاضي";
  if (lines.some((l) => l.countedQty == null)) return "في أصناف لسه معدودتش — اعدّها أو شيلها من الورقة";
  if (lines.some((l) => Number(l.countedQty) < 0)) return "الكمية المعدودة مايكونش بالسالب";
  if (!variances(lines).length) return "مفيش فروق — الجرد مطابق، اقفله من غير تسوية";
  return null;
}
