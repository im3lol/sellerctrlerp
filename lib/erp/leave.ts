// Shared, client-safe leave helpers (no db imports).

export const LEAVE_TYPES = [
  { value: "ANNUAL", label: "إجازة سنوية" },
  { value: "SICK", label: "إجازة مرضية" },
  { value: "UNPAID", label: "إجازة بدون أجر" },
  { value: "OTHER", label: "أخرى" },
] as const;

export const LEAVE_TYPE_LABEL: Record<string, string> = Object.fromEntries(LEAVE_TYPES.map((t) => [t.value, t.label]));

export const LEAVE_STATUS_LABEL: Record<string, string> = { DRAFT: "مسودة", APPROVED: "معتمدة", REJECTED: "مرفوضة" };

/** Inclusive calendar-day span between two ISO dates (both ends counted).
 *  ponytail: calendar days, not working days — add a holidays/weekend calendar if payroll needs net working days. */
export function leaveDays(start: string, end: string): number {
  const s = new Date(start + "T00:00:00");
  const e = new Date(end + "T00:00:00");
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || e < s) return 0;
  return Math.round((e.getTime() - s.getTime()) / 86_400_000) + 1;
}

// Default weekend for Egypt: Friday (5) + Saturday (6) as JS getDay() values.
export const DEFAULT_WEEKEND = [5, 6];

/** Net working days in [start, end] inclusive, excluding weekend days and any
 *  date in `holidays` (ISO yyyy-mm-dd strings). Returns 0 for an invalid range. */
export function workingDays(start: string, end: string, holidays: Iterable<string> = [], weekend: number[] = DEFAULT_WEEKEND): number {
  const s = new Date(start + "T00:00:00");
  const e = new Date(end + "T00:00:00");
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || e < s) return 0;
  const holiSet = holidays instanceof Set ? holidays : new Set(holidays);
  const weekendSet = new Set(weekend);
  let count = 0;
  for (const d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
    if (weekendSet.has(d.getDay())) continue;
    if (holiSet.has(d.toISOString().slice(0, 10))) continue;
    count++;
  }
  return count;
}
