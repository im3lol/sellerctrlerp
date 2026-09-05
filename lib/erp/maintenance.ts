/**
 * Maintenance: when a machine is due, what a repair cost, and how reliable the thing has
 * been. Pure — the same arithmetic serves a workshop and a fleet, which is why there is
 * one engine and two faces over it.
 *
 * The asset itself is a `fixed_assets` row. A second asset master would be a second place
 * to disagree with, and the machine on the workshop floor and the machine in the ledger
 * are the same machine.
 */

export type MeterType = "NONE" | "HOURS" | "KM";

export const METER_LABEL: Record<MeterType, string> = {
  NONE: "بدون عدّاد",
  HOURS: "ساعة",
  KM: "كم",
};

export type MaintenancePlan = {
  id: string;
  nameAr: string;
  /** Every N days. 0 = not time-based. */
  everyDays: number;
  /** Every N meter units. 0 = not usage-based. */
  everyMeter: number;
  lastDoneAt: string | null;
  lastDoneMeter: number | null;
  isActive: boolean;
};

export type DueStatus = {
  /** The date it falls due, when the plan has a time trigger. */
  dueDate: string | null;
  /** The reading it falls due at, when the plan has a usage trigger. */
  dueMeter: number | null;
  isDue: boolean;
  /** Days past due; negative means days remaining. */
  daysLate: number | null;
  /** Meter units past due; negative means units remaining. */
  meterOver: number | null;
  reason: string;
};

const DAY = 86_400_000;
const day = (d: Date | string) => new Date(typeof d === "string" ? `${d.slice(0, 10)}T00:00:00.000Z` : d).getTime();
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

/**
 * A reading only ever goes forward. An odometer that drops means someone typed the wrong
 * number, and accepting it would quietly reset every usage-based plan on the vehicle.
 */
export function validateReading(previous: number | null, next: number): string | null {
  if (!Number.isFinite(next) || next < 0) return "القراءة لازم تكون رقم موجب";
  if (previous != null && next < previous) return `القراءة أقل من آخر قراءة (${previous}) — العدّاد مبيرجعش لورا`;
  return null;
}

/**
 * When the plan next comes due. A plan can carry both triggers; whichever arrives first
 * wins, because a machine that has done its hours is due even if the month is not up.
 */
export function nextDue(
  plan: MaintenancePlan,
  asset: { currentMeter: number | null },
  today: Date = new Date(),
): DueStatus {
  const now = day(today);

  let dueDate: string | null = null;
  let daysLate: number | null = null;
  if (plan.everyDays > 0 && plan.lastDoneAt) {
    const t = day(plan.lastDoneAt) + plan.everyDays * DAY;
    dueDate = iso(t);
    daysLate = Math.round((now - t) / DAY);
  } else if (plan.everyDays > 0) {
    // Never done: due now, so a new plan surfaces instead of waiting for a first service
    // that nobody remembers to book.
    dueDate = iso(now);
    daysLate = 0;
  }

  let dueMeter: number | null = null;
  let meterOver: number | null = null;
  if (plan.everyMeter > 0 && plan.lastDoneMeter != null) {
    dueMeter = plan.lastDoneMeter + plan.everyMeter;
    if (asset.currentMeter != null) meterOver = Math.round((asset.currentMeter - dueMeter) * 100) / 100;
  }

  const timeDue = daysLate != null && daysLate >= 0;
  const meterDue = meterOver != null && meterOver >= 0;

  let reason = "مش مستحقة";
  if (timeDue && meterDue) reason = `متأخرة ${daysLate} يوم و${meterOver} وحدة`;
  else if (timeDue) reason = daysLate === 0 ? "مستحقة النهارده" : `متأخرة ${daysLate} يوم`;
  else if (meterDue) reason = `عدّى موعدها بـ ${meterOver} وحدة`;
  else if (daysLate != null && meterOver != null) reason = `فاضل ${-daysLate} يوم أو ${-meterOver} وحدة`;
  else if (daysLate != null) reason = `فاضل ${-daysLate} يوم`;
  else if (meterOver != null) reason = `فاضل ${-meterOver} وحدة`;
  else if (plan.everyMeter > 0) reason = "محتاجة أول قراءة عدّاد";

  return { dueDate, dueMeter, isDue: plan.isActive && (timeDue || meterDue), daysLate, meterOver, reason };
}

export type WorkOrderPart = { quantity: number; unitCost: number };

/**
 * What a repair cost. Parts are real money out of the store and are posted; labour hours
 * are analytical only — the wage was already booked by payroll, and posting it again
 * would charge the company twice for the same hour.
 */
export function workOrderCost(input: {
  parts: WorkOrderPart[];
  laborHours?: number;
  laborRate?: number;
}): { parts: number; labor: number; total: number } {
  const r = (n: number) => Math.round(n * 100) / 100;
  const parts = r(input.parts.reduce((s, p) => s + p.quantity * p.unitCost, 0));
  const labor = r((input.laborHours ?? 0) * (input.laborRate ?? 0));
  return { parts, labor, total: r(parts + labor) };
}

export type ReliabilityInput = {
  /** Corrective orders only — a planned service is not a failure. */
  reportedAt: string;
  completedAt: string | null;
  downtimeHours: number | null;
};

/**
 * Mean time to repair: from the moment a fault was reported to the moment it was fixed.
 * Reported time, not started time — the hours a machine waits for someone to look at it
 * are hours it is not producing.
 */
export function mttr(orders: ReliabilityInput[]): number | null {
  const done = orders.filter((o) => o.completedAt);
  if (done.length === 0) return null;
  const hours = done.reduce((s, o) => s + (new Date(o.completedAt!).getTime() - new Date(o.reportedAt).getTime()) / 3_600_000, 0);
  return Math.round((hours / done.length) * 100) / 100;
}

/**
 * Mean time between failures, over the window the failures actually span. Needs two
 * failures to mean anything — one failure has no "between".
 */
export function mtbf(orders: ReliabilityInput[], now: Date = new Date()): number | null {
  if (orders.length < 2) return null;
  const times = orders.map((o) => new Date(o.reportedAt).getTime()).sort((a, b) => a - b);
  const span = (times[times.length - 1] - times[0]) / 3_600_000;
  const downtime = orders.reduce((s, o) => s + (o.downtimeHours ?? 0), 0);
  const uptime = Math.max(0, span - downtime);
  void now;
  return Math.round((uptime / (times.length - 1)) * 100) / 100;
}

/** Papers that run out: a licence, an insurance policy, a permit. */
export type Expiry = { id: string; label: string; kind: string; expiresAt: string | null };

/**
 * What expires soon, worst first. An expired document sorts above one that is merely
 * close, because a truck with a lapsed licence is not "nearly a problem".
 */
export function expiringSoon(
  rows: Expiry[],
  withinDays = 30,
  today: Date = new Date(),
): (Expiry & { daysLeft: number; expired: boolean })[] {
  const now = day(today);
  return rows
    .filter((r) => r.expiresAt)
    .map((r) => {
      const daysLeft = Math.round((day(r.expiresAt!) - now) / DAY);
      return { ...r, daysLeft, expired: daysLeft < 0 };
    })
    .filter((r) => r.daysLeft <= withinDays)
    .sort((a, b) => a.daysLeft - b.daysLeft);
}
