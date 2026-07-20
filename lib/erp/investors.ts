import { round2 } from "@/lib/erp/money";

/**
 * Investor equity maths. Pure — the actions do the posting, this decides the
 * numbers, and the numbers are the part that quietly goes wrong.
 */

export type CapitalRow = { investorId: string; amount: number };
export type Owner = { investorId: string; percent: number };
export type Share = { investorId: string; percent: number; share: number };

/**
 * Net capital per investor → ownership %.
 *
 * Contributions are positive, capital withdrawals negative; pass both and this
 * nets them. An investor whose capital nets to ≤ 0 owns nothing rather than a
 * negative slice — a negative percent would hand them a negative profit share,
 * i.e. bill them for the company's profit.
 *
 * Returns percentages that sum to 100 (or an empty list when there is no capital
 * at all — dividing by zero equity is not a rounding problem, it's a "nobody owns
 * this yet" problem, and the caller must say so rather than distribute NaN).
 */
export function computeOwnership(rows: CapitalRow[]): Owner[] {
  const net = new Map<string, number>();
  for (const r of rows) net.set(r.investorId, (net.get(r.investorId) ?? 0) + r.amount);

  const positive = [...net.entries()].filter(([, v]) => v > 0);
  const total = positive.reduce((s, [, v]) => s + v, 0);
  if (total <= 0) return [];

  return positive
    .map(([investorId, v]) => ({ investorId, percent: round2((v / total) * 100) }))
    .sort((a, b) => b.percent - a.percent);
}

/**
 * Split `total` across owners by percentage, to the cent.
 *
 * The whole point is the remainder. Three equal partners on 100.00 get 33.33 each
 * by naive rounding, and 0.01 vanishes — the distribution entry then wouldn't
 * balance against the liability it raises, and postEntry would (correctly) throw.
 * So allocate in integer cents and hand any leftover cents to the largest holders,
 * one each, largest-remainder style. Σ shares === total, exactly, always.
 *
 * Works for a negative total too (distributing a loss): the leftover is taken from
 * the largest holders instead of given.
 */
export function allocateProfit(total: number, owners: Owner[]): Share[] {
  if (owners.length === 0) return [];

  const totalCents = Math.round(round2(total) * 100);
  const raw = owners.map((o) => ({ ...o, exact: (totalCents * o.percent) / 100 }));
  const floored = raw.map((r) => ({ ...r, cents: Math.trunc(r.exact) }));

  let leftover = totalCents - floored.reduce((s, r) => s + r.cents, 0);
  // Largest fractional part first; ties broken by the bigger stake so the result is
  // deterministic rather than dependent on input order.
  const order = [...floored]
    .map((r, i) => ({ i, frac: Math.abs(r.exact - r.cents), percent: r.percent }))
    .sort((a, b) => b.frac - a.frac || b.percent - a.percent);

  const step = leftover >= 0 ? 1 : -1;
  for (let k = 0; leftover !== 0 && k < order.length * 2; k++) {
    floored[order[k % order.length].i].cents += step;
    leftover -= step;
  }

  return floored.map((r) => ({ investorId: r.investorId, percent: r.percent, share: r.cents / 100 }));
}
