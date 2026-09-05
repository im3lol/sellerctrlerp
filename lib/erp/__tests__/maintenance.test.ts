import { describe, it, expect } from "vitest";
import {
  validateReading, nextDue, workOrderCost, mttr, mtbf, expiringSoon,
  type MaintenancePlan,
} from "@/lib/erp/maintenance";
import {
  consumption, fuelOutliers, costPerKm, tripDistance, validateTrip, type FuelLog,
} from "@/lib/erp/fleet";

const TODAY = new Date("2026-09-05T00:00:00Z");

const plan = (over: Partial<MaintenancePlan> = {}): MaintenancePlan => ({
  id: "p1", nameAr: "تغيير زيت", everyDays: 0, everyMeter: 0,
  lastDoneAt: null, lastDoneMeter: null, isActive: true, ...over,
});

describe("meter readings", () => {
  it("never go backwards", () => {
    expect(validateReading(12000, 11900)).toMatch(/مبيرجعش لورا/);
    expect(validateReading(12000, 12000)).toBeNull();
    expect(validateReading(null, 500)).toBeNull();
  });

  it("refuse nonsense", () => {
    expect(validateReading(null, -5)).toMatch(/رقم موجب/);
    expect(validateReading(null, Number.NaN)).toMatch(/رقم موجب/);
  });
});

describe("when a plan is due", () => {
  it("counts days from the last service", () => {
    const d = nextDue(plan({ everyDays: 90, lastDoneAt: "2026-06-01" }), { currentMeter: null }, TODAY);
    expect(d.dueDate).toBe("2026-08-30");
    expect(d.daysLate).toBe(6);
    expect(d.isDue).toBe(true);
  });

  it("says how long is left when it is not due", () => {
    const d = nextDue(plan({ everyDays: 90, lastDoneAt: "2026-08-01" }), { currentMeter: null }, TODAY);
    expect(d.isDue).toBe(false);
    expect(d.reason).toMatch(/فاضل 55 يوم/);
  });

  it("a brand-new plan is due now rather than waiting for a first service", () => {
    const d = nextDue(plan({ everyDays: 30 }), { currentMeter: null }, TODAY);
    expect(d.isDue).toBe(true);
    expect(d.reason).toMatch(/النهارده/);
  });

  it("counts usage when the plan runs on the meter", () => {
    const d = nextDue(plan({ everyMeter: 5000, lastDoneMeter: 20000 }), { currentMeter: 25400 }, TODAY);
    expect(d.dueMeter).toBe(25000);
    expect(d.meterOver).toBe(400);
    expect(d.isDue).toBe(true);
  });

  it("whichever trigger arrives first wins", () => {
    const both = plan({ everyDays: 180, lastDoneAt: "2026-09-01", everyMeter: 5000, lastDoneMeter: 20000 });
    // Not due on time at all, but the machine has done the hours.
    const d = nextDue(both, { currentMeter: 26000 }, TODAY);
    expect(d.isDue).toBe(true);
    expect(d.reason).toMatch(/عدّى موعدها/);
  });

  it("a usage plan with no reading yet says so instead of guessing", () => {
    const d = nextDue(plan({ everyMeter: 5000, lastDoneMeter: 20000 }), { currentMeter: null }, TODAY);
    expect(d.isDue).toBe(false);
    expect(d.reason).toMatch(/قراءة عدّاد/);
  });

  it("a stopped plan is never due", () => {
    const d = nextDue(plan({ everyDays: 30, lastDoneAt: "2020-01-01", isActive: false }), { currentMeter: null }, TODAY);
    expect(d.daysLate).toBeGreaterThan(0);
    expect(d.isDue).toBe(false);
  });
});

describe("what a repair cost", () => {
  it("adds parts and labour", () => {
    const c = workOrderCost({ parts: [{ quantity: 2, unitCost: 150 }, { quantity: 1, unitCost: 40 }], laborHours: 3, laborRate: 50 });
    expect(c.parts).toBe(340);
    expect(c.labor).toBe(150);
    expect(c.total).toBe(490);
  });

  it("is just the parts when nobody logged hours", () => {
    expect(workOrderCost({ parts: [{ quantity: 1, unitCost: 99.5 }] })).toEqual({ parts: 99.5, labor: 0, total: 99.5 });
  });

  it("is zero for a repair that used nothing", () => {
    expect(workOrderCost({ parts: [] }).total).toBe(0);
  });
});

describe("reliability", () => {
  const orders = [
    { reportedAt: "2026-08-01T08:00:00Z", completedAt: "2026-08-01T12:00:00Z", downtimeHours: 4 },
    { reportedAt: "2026-08-11T08:00:00Z", completedAt: "2026-08-11T10:00:00Z", downtimeHours: 2 },
    { reportedAt: "2026-08-21T08:00:00Z", completedAt: null, downtimeHours: null },
  ];

  it("measures repair time from when the fault was reported, not when work began", () => {
    expect(mttr(orders)).toBe(3);
  });

  it("has no repair time when nothing has been finished", () => {
    expect(mttr([{ reportedAt: "2026-08-01T08:00:00Z", completedAt: null, downtimeHours: null }])).toBeNull();
  });

  it("takes downtime out of the running hours between failures", () => {
    // 20 days across 3 failures = 480h span, less 6h down, over 2 gaps.
    expect(mtbf(orders)).toBe(237);
  });

  it("refuses a verdict on a single failure", () => {
    expect(mtbf([orders[0]])).toBeNull();
  });
});

describe("papers running out", () => {
  const rows = [
    { id: "a", label: "رخصة ١٢٣", kind: "رخصة", expiresAt: "2026-09-20" },
    { id: "b", label: "تأمين ٤٥٦", kind: "تأمين", expiresAt: "2026-08-30" },
    { id: "c", label: "رخصة ٧٨٩", kind: "رخصة", expiresAt: "2027-01-01" },
    { id: "d", label: "بدون تاريخ", kind: "رخصة", expiresAt: null },
  ];

  it("puts what already expired above what is merely close", () => {
    const out = expiringSoon(rows, 30, TODAY);
    expect(out.map((r) => r.id)).toEqual(["b", "a"]);
    expect(out[0].expired).toBe(true);
    expect(out[1].daysLeft).toBe(15);
  });

  it("ignores what is far off and what was never recorded", () => {
    expect(expiringSoon(rows, 30, TODAY).some((r) => r.id === "c" || r.id === "d")).toBe(false);
  });
});

// ── fleet ───────────────────────────────────────────────────────────────
const fill = (id: string, meter: number | null, liters: number, cost: number): FuelLog =>
  ({ id, at: "2026-09-01", meterValue: meter, liters, cost });

describe("fuel", () => {
  it("measures between fills, so the first one gives no efficiency", () => {
    const c = consumption([fill("1", 10000, 40, 800), fill("2", 10500, 45, 900)]);
    expect(c).toHaveLength(1);
    expect(c[0].distance).toBe(500);
    expect(c[0].per100).toBe(9);
    expect(c[0].costPerKm).toBe(1.8);
  });

  it("skips fills with no odometer written down", () => {
    expect(consumption([fill("1", 10000, 40, 800), fill("2", null, 45, 900)])).toHaveLength(0);
  });

  it("ignores two fills at the same reading", () => {
    expect(consumption([fill("1", 10000, 40, 800), fill("2", 10000, 20, 400)])).toHaveLength(0);
  });

  it("flags a fill that burns well past this vehicle's own normal", () => {
    const logs = [10000, 10500, 11000, 11500, 12000, 12500].map((m, i) =>
      fill(String(i), m, i === 5 ? 90 : 45, 900));
    const out = fuelOutliers(consumption(logs));
    expect(out).toHaveLength(1);
    expect(out[0].per100).toBe(18);
  });

  it("stays quiet with too few fills to know what normal is", () => {
    expect(fuelOutliers(consumption([fill("1", 10000, 40, 800), fill("2", 10500, 90, 1800)]))).toHaveLength(0);
  });
});

describe("cost per kilometre", () => {
  it("includes depreciation — leaving it out makes an old truck look cheap", () => {
    const c = costPerKm({ distance: 10000, fuelCost: 18000, maintenanceCost: 6000, depreciation: 12000 });
    expect(c.total).toBe(36000);
    expect(c.perKm).toBe(3.6);
    expect(c.breakdown.depreciation).toBe(12000);
  });

  it("does not divide by a distance nobody drove", () => {
    expect(costPerKm({ distance: 0, fuelCost: 500, maintenanceCost: 0 }).perKm).toBe(0);
  });
});

describe("trips", () => {
  it("counts only the ones that came back", () => {
    expect(tripDistance([{ startMeter: 100, endMeter: 350 }, { startMeter: 350, endMeter: null }])).toBe(250);
  });

  it("refuses a trip that ended before it started", () => {
    expect(validateTrip(500, 400)).toMatch(/أقل من البداية/);
    expect(validateTrip(500, 900)).toBeNull();
    expect(validateTrip(500, null)).toBeNull();
  });
});
