/**
 * Which supplier bills to pay this week. The aging report says who is owed what; the
 * cash-flow forecast says what will be in the bank. Neither answers the question a
 * finance person actually asks on Sunday morning — so this puts the two side by side and
 * proposes an order.
 *
 * The rule is deliberately dull: oldest due first, and stop when the available cash runs
 * out. Anything cleverer (optimising early-payment discounts against float) is a guess
 * about a business this code cannot see. What it does add is the discount deadline as a
 * visible flag, so a human can reorder with the facts in front of them.
 *
 * Pure — no db — so the ordering is testable.
 */

export type PayableBill = {
  id: string;
  number: string;
  supplierId: string;
  supplierName: string;
  dueDate: string | Date | null;
  /** Invoice total minus what has already been paid. */
  outstanding: number;
  /** Days after the invoice date within which a discount still applies, if any. */
  discountDays?: number | null;
  discountPercent?: number | null;
  invoiceDate?: string | Date | null;
};

export type PlannedPayment = PayableBill & {
  /** Days past due at the planning date; negative means not due yet. */
  daysOverdue: number;
  /** Cash left after paying this one, following the plan's order. */
  cashAfter: number;
  /** Whether the available cash covers it. */
  affordable: boolean;
  /** Paying by this date still earns the early-payment discount. */
  discountDeadline: Date | null;
  /** What the discount is worth, when it is still reachable at the planning date. */
  discountValue: number | null;
};

const DAY = 86_400_000;

const asDate = (v: string | Date | null | undefined): Date | null => {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** Whole days `date` is past `on`. Undated bills sort last, so they get -Infinity. */
export function daysOverdue(dueDate: string | Date | null | undefined, on: Date): number {
  const d = asDate(dueDate);
  if (!d) return Number.NEGATIVE_INFINITY;
  return Math.floor((on.getTime() - d.getTime()) / DAY);
}

/**
 * Order the bills and walk the cash down. Most overdue first; an undated bill sits at
 * the end, since nobody is chasing it yet. Every bill is returned — the ones the cash
 * cannot reach are marked, not hidden, because "what I can't pay this week" is half the
 * reason to look at this screen.
 */
export function planPayments(bills: PayableBill[], availableCash: number, on: Date = new Date()): PlannedPayment[] {
  const sorted = [...bills].sort((a, b) => {
    const d = daysOverdue(b.dueDate, on) - daysOverdue(a.dueDate, on);
    if (d !== 0 && Number.isFinite(d)) return d;
    // Undated last, then bigger first so the cash is committed where it matters.
    const au = asDate(a.dueDate) ? 0 : 1;
    const bu = asDate(b.dueDate) ? 0 : 1;
    if (au !== bu) return au - bu;
    return b.outstanding - a.outstanding;
  });

  let cash = Number(availableCash) || 0;
  return sorted.map((b) => {
    const affordable = b.outstanding <= cash + 1e-6;
    if (affordable) cash -= b.outstanding;

    const invDate = asDate(b.invoiceDate);
    const deadline = invDate && b.discountDays ? new Date(invDate.getTime() + b.discountDays * DAY) : null;
    const stillEarns = deadline != null && on.getTime() <= deadline.getTime() + DAY - 1;

    return {
      ...b,
      daysOverdue: daysOverdue(b.dueDate, on),
      cashAfter: cash,
      affordable,
      discountDeadline: deadline,
      discountValue: stillEarns && b.discountPercent ? round2(b.outstanding * (b.discountPercent / 100)) : null,
    };
  });
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Headline numbers for the top of the screen. */
export function planSummary(planned: PlannedPayment[], availableCash: number) {
  const total = round2(planned.reduce((s, p) => s + p.outstanding, 0));
  const overdue = round2(planned.filter((p) => p.daysOverdue > 0).reduce((s, p) => s + p.outstanding, 0));
  const payable = round2(planned.filter((p) => p.affordable).reduce((s, p) => s + p.outstanding, 0));
  const discounts = round2(planned.reduce((s, p) => s + (p.discountValue ?? 0), 0));
  return {
    total,
    overdue,
    payable,
    shortfall: round2(Math.max(0, total - (Number(availableCash) || 0))),
    discountsAtRisk: discounts,
    count: planned.length,
    unaffordable: planned.filter((p) => !p.affordable).length,
  };
}
