import { describe, it, expect } from "vitest";
import {
  validateTimesheet, laborTotals, budgetStatus, projectProgress, billableMilestones, readyToBill,
  type Timesheet, type Phase,
} from "@/lib/erp/projects";

const TODAY = new Date("2026-09-05T00:00:00Z");

const sheet = (over: Partial<Timesheet> = {}): Timesheet => ({
  id: "t1", employeeId: "e1", hours: 8, costRate: 50, billRate: 120,
  billable: true, invoicedAt: null, ...over,
});

const phase = (over: Partial<Phase> = {}): Phase => ({
  id: "p1", nameAr: "مرحلة", sortOrder: 1, budget: 0, status: "PENDING",
  billAmount: 0, invoicedAt: null, ...over,
});

describe("logging hours", () => {
  it("refuses a day that never happened yet", () => {
    expect(validateTimesheet(8, "2026-09-20", TODAY)).toMatch(/المستقبل/);
  });

  it("refuses more hours than a day has", () => {
    expect(validateTimesheet(30, "2026-09-04", TODAY)).toMatch(/٢٤ ساعة/);
  });

  it("refuses zero and negative", () => {
    expect(validateTimesheet(0, "2026-09-04", TODAY)).toMatch(/أكبر من صفر/);
    expect(validateTimesheet(-3, "2026-09-04", TODAY)).toMatch(/أكبر من صفر/);
  });

  it("accepts an ordinary day, and today", () => {
    expect(validateTimesheet(7.5, "2026-09-04", TODAY)).toBeNull();
    expect(validateTimesheet(7.5, "2026-09-05", TODAY)).toBeNull();
  });
});

describe("what the labour came to", () => {
  it("separates what it cost from what it can be charged at", () => {
    const t = laborTotals([sheet({ hours: 10 }), sheet({ id: "t2", hours: 5, billable: false })]);
    expect(t.hours).toBe(15);
    expect(t.billableHours).toBe(10);
    expect(t.cost).toBe(750);
    expect(t.billable).toBe(1200);
  });

  it("stops counting hours already invoiced as still billable", () => {
    const t = laborTotals([sheet({ hours: 10 }), sheet({ id: "t2", hours: 10, invoicedAt: "2026-09-01" })]);
    expect(t.billable).toBe(2400);
    expect(t.unbilled).toBe(1200);
  });

  it("leaves labour unpriced when nobody set a rate", () => {
    expect(laborTotals([sheet({ costRate: 0 })]).cost).toBe(0);
  });
});

describe("budget against reality", () => {
  it("calls a project lost while there is still time to act", () => {
    const b = budgetStatus({ budget: 100000, spent: 60000, invoiced: 0, percentComplete: 40 });
    expect(b.overBudget).toBe(false);
    expect(b.headingOver).toBe(true);
    expect(b.forecast).toBe(150000);
    expect(b.verdict).toMatch(/هيعدّي/);
  });

  it("says plainly when it has already overrun", () => {
    const b = budgetStatus({ budget: 100000, spent: 120000, invoiced: 90000, percentComplete: 80 });
    expect(b.overBudget).toBe(true);
    expect(b.remaining).toBe(-20000);
    expect(b.margin).toBe(-30000);
    expect(b.verdict).toMatch(/عدّى الميزانية بـ 20000/);
  });

  it("stays quiet about a forecast while the burn rate is still noise", () => {
    const b = budgetStatus({ budget: 100000, spent: 4000, invoiced: 0, percentComplete: 2 });
    expect(b.forecast).toBeNull();
    expect(b.headingOver).toBe(false);
  });

  it("refuses to compare against a budget nobody set", () => {
    const b = budgetStatus({ budget: 0, spent: 5000, invoiced: 0, percentComplete: 50 });
    expect(b.overBudget).toBe(false);
    expect(b.verdict).toMatch(/مفيش ميزانية/);
  });

  it("reports the margin, which is the number that decides the next quote", () => {
    expect(budgetStatus({ budget: 100000, spent: 70000, invoiced: 110000, percentComplete: 100 }).margin).toBe(40000);
  });
});

describe("progress", () => {
  it("weights phases by what they are worth, not by how many there are", () => {
    const phases = [
      phase({ id: "a", budget: 90000, status: "PENDING" }),
      phase({ id: "b", budget: 2000, status: "DONE" }),
      phase({ id: "c", budget: 2000, status: "DONE" }),
      phase({ id: "d", budget: 3000, status: "DONE" }),
      phase({ id: "e", budget: 3000, status: "DONE" }),
    ];
    expect(projectProgress(phases)).toBe(10); // not 80
  });

  it("counts a phase in progress as half done", () => {
    expect(projectProgress([phase({ status: "IN_PROGRESS" }), phase({ id: "b", status: "PENDING" })])).toBe(25);
  });

  it("falls back to counting when no phase carries a budget", () => {
    expect(projectProgress([phase({ status: "DONE" }), phase({ id: "b", status: "PENDING" })])).toBe(50);
  });

  it("is zero for a project with no phases at all", () => {
    expect(projectProgress([])).toBe(0);
  });
});

describe("what can be billed now", () => {
  const phases = [
    phase({ id: "a", nameAr: "التصميم", status: "DONE", billAmount: 20000 }),
    phase({ id: "b", nameAr: "التنفيذ", status: "IN_PROGRESS", billAmount: 50000 }),
    phase({ id: "c", nameAr: "التسليم", status: "DONE", billAmount: 10000, invoicedAt: "2026-08-01" }),
  ];

  it("takes finished milestones that have not been invoiced", () => {
    expect(billableMilestones(phases).map((p) => p.id)).toEqual(["a"]);
  });

  it("adds uninvoiced billable hours to the milestone total", () => {
    const r = readyToBill(phases, [sheet({ hours: 10 })]);
    expect(r.milestones).toBe(20000);
    expect(r.time).toBe(1200);
    expect(r.total).toBe(21200);
    expect(r.lines.map((l) => l.label)).toEqual(["التصميم", "ساعات عمل غير مفوترة"]);
  });

  it("leaves the time line out entirely when there are no unbilled hours", () => {
    const r = readyToBill(phases, [sheet({ invoicedAt: "2026-09-01" })]);
    expect(r.lines).toHaveLength(1);
    expect(r.total).toBe(20000);
  });

  it("comes to nothing when there is nothing to bill", () => {
    expect(readyToBill([], []).total).toBe(0);
  });
});
