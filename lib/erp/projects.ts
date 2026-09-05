/**
 * Projects. A project is a **cost dimension**, exactly like a cost centre — not a second
 * costing engine. Money reaches it the way money always reaches the ledger: an expense, a
 * bill, an invoice, each stamped with the project it belongs to. Everything here is the
 * arithmetic of comparing that against what was promised.
 *
 * The one number a project owner needs is: is this going to finish inside its budget, and
 * if not, when did it stop being able to. Every function below serves that question.
 */

export type ProjectStatus = "DRAFT" | "ACTIVE" | "ON_HOLD" | "DONE" | "CANCELLED";

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  DRAFT: "مسودة",
  ACTIVE: "شغّال",
  ON_HOLD: "متوقّف",
  DONE: "مقفول",
  CANCELLED: "ملغي",
};

export type Timesheet = {
  id: string;
  employeeId: string;
  hours: number;
  /** Cost to the company per hour. Zero means nobody set a rate, so labour is unpriced. */
  costRate: number;
  /** What the customer is charged per hour, when the work is billable. */
  billRate: number;
  billable: boolean;
  invoicedAt: string | null;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Hours are a day's worth at most, and a day cannot hold a negative one. */
export function validateTimesheet(hours: number, date: string, today: Date = new Date()): string | null {
  if (!Number.isFinite(hours) || hours <= 0) return "الساعات لازم تكون أكبر من صفر";
  if (hours > 24) return "اليوم ٢٤ ساعة — راجع الرقم";
  if (new Date(`${date.slice(0, 10)}T00:00:00.000Z`).getTime() > today.getTime() + 86_400_000) {
    return "مينفعش تسجّل ساعات في المستقبل";
  }
  return null;
}

/** What the labour on a project cost, and what of it can still be invoiced. */
export function laborTotals(sheets: Timesheet[]): {
  hours: number; billableHours: number; cost: number; billable: number; unbilled: number;
} {
  let hours = 0, billableHours = 0, cost = 0, billable = 0, unbilled = 0;
  for (const s of sheets) {
    hours += s.hours;
    cost += s.hours * s.costRate;
    if (s.billable) {
      billableHours += s.hours;
      billable += s.hours * s.billRate;
      if (!s.invoicedAt) unbilled += s.hours * s.billRate;
    }
  }
  return { hours: r2(hours), billableHours: r2(billableHours), cost: r2(cost), billable: r2(billable), unbilled: r2(unbilled) };
}

export type BudgetInput = {
  budget: number;
  /** Everything already spent: expenses, bills, and priced labour. */
  spent: number;
  /** Revenue recognised on the project so far. */
  invoiced: number;
  /** 0–100. What the people doing the work say is done. */
  percentComplete: number;
};

export type BudgetStatus = {
  budget: number;
  spent: number;
  remaining: number;
  invoiced: number;
  margin: number;
  usedPercent: number;
  /** Spend projected to completion at the current burn rate. */
  forecast: number | null;
  overBudget: boolean;
  /** Will overrun if nothing changes, even though it has not yet. */
  headingOver: boolean;
  verdict: string;
};

/**
 * Budget against reality. The forecast is the part that earns its keep: a project 40%
 * done that has spent 60% of its budget is already lost, and saying so while there is
 * still time to act is the whole value of tracking it.
 */
export function budgetStatus(input: BudgetInput): BudgetStatus {
  const budget = r2(input.budget);
  const spent = r2(input.spent);
  const invoiced = r2(input.invoiced);
  const pct = Math.min(100, Math.max(0, input.percentComplete));

  const usedPercent = budget > 0 ? r2((spent / budget) * 100) : 0;
  // Below a few percent complete the burn rate is noise, not a trend.
  const forecast = pct >= 5 ? r2((spent / pct) * 100) : null;
  const overBudget = budget > 0 && spent > budget;
  const headingOver = !overBudget && budget > 0 && forecast != null && forecast > budget;

  let verdict = "في حدود الميزانية";
  if (budget <= 0) verdict = "مفيش ميزانية متحطّة — مفيش حاجة نقارن بيها";
  else if (overBudget) verdict = `عدّى الميزانية بـ ${r2(spent - budget)}`;
  else if (headingOver) verdict = `ماشي على ${forecast} مقابل ميزانية ${budget} — هيعدّي`;
  else if (pct > 0) verdict = `خلّص ${pct}٪ وصرف ${usedPercent}٪`;

  return {
    budget, spent, remaining: r2(budget - spent), invoiced,
    margin: r2(invoiced - spent), usedPercent,
    forecast, overBudget, headingOver, verdict,
  };
}

export type Phase = {
  id: string;
  nameAr: string;
  sortOrder: number;
  budget: number;
  status: "PENDING" | "IN_PROGRESS" | "DONE";
  /** Fixed amount to bill when the phase completes. Zero = this phase is not a milestone. */
  billAmount: number;
  invoicedAt: string | null;
};

/**
 * How far along the project is, weighted by what each phase is worth. Weighting by budget
 * rather than by count is what stops five trivial phases from making a stalled project
 * look 83% done.
 */
export function projectProgress(phases: Phase[]): number {
  if (phases.length === 0) return 0;
  const weighted = phases.some((p) => p.budget > 0);
  const total = weighted ? phases.reduce((s, p) => s + p.budget, 0) : phases.length;
  if (total <= 0) return 0;
  const done = phases.reduce((s, p) => {
    const weight = weighted ? p.budget : 1;
    return s + (p.status === "DONE" ? weight : p.status === "IN_PROGRESS" ? weight / 2 : 0);
  }, 0);
  return Math.round((done / total) * 100);
}

/** Milestones finished but not yet billed — money sitting on the table. */
export function billableMilestones(phases: Phase[]): Phase[] {
  return phases.filter((p) => p.status === "DONE" && p.billAmount > 0 && !p.invoicedAt);
}

/**
 * What a project can invoice right now: completed milestones plus billable hours nobody
 * has charged for yet. Refuses to name a figure when there is nothing to bill, rather
 * than offering a zero invoice.
 */
export function readyToBill(phases: Phase[], sheets: Timesheet[]): {
  milestones: number; time: number; total: number; lines: { label: string; amount: number }[];
} {
  const ms = billableMilestones(phases);
  const milestones = r2(ms.reduce((s, p) => s + p.billAmount, 0));
  const time = laborTotals(sheets).unbilled;
  return {
    milestones, time, total: r2(milestones + time),
    lines: [
      ...ms.map((p) => ({ label: p.nameAr, amount: r2(p.billAmount) })),
      ...(time > 0 ? [{ label: "ساعات عمل غير مفوترة", amount: time }] : []),
    ],
  };
}
