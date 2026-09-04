/**
 * Working-day arithmetic for attendance. The table has existed for a while and hourly
 * payroll reads from it, but nothing ever wrote to it — so hours were always zero and
 * every hourly employee was paid nothing. These are the rules the three write paths
 * (typed by HR, clocked by the employee, imported from a device) all go through.
 *
 * Pure — no db — so the edge cases that actually happen (a shift over midnight, a
 * forgotten clock-out, a break longer than the shift) are testable.
 */

export type Punch = { clockIn: string | Date; clockOut?: string | Date | null };
export type Break = { start: string; end: string | null };

const HOUR = 3600;

const t = (v: string | Date | null | undefined): number | null => {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
};

/** Seconds inside closed breaks. An open break (no end) counts nothing — it is still running. */
export function breakSeconds(breaks: Break[] | null | undefined): number {
  if (!breaks?.length) return 0;
  let total = 0;
  for (const b of breaks) {
    const s = t(b.start), e = t(b.end);
    if (s == null || e == null || e <= s) continue;
    total += Math.floor((e - s) / 1000);
  }
  return total;
}

/**
 * Worked seconds for one day: out − in, minus closed breaks.
 *
 * A clock-out before the clock-in means the shift crossed midnight — add a day rather
 * than storing a negative, which is what a naive subtraction would do to a night shift.
 * An open day (no clock-out) is 0: the hours are not known yet, and guessing them is how
 * payroll pays for time nobody worked.
 */
export function workedSeconds(punch: Punch, breaks?: Break[] | null): number {
  const inAt = t(punch.clockIn);
  const outAt = t(punch.clockOut);
  if (inAt == null || outAt == null) return 0;

  let span = Math.floor((outAt - inAt) / 1000);
  if (span < 0) span += 24 * HOUR; // crossed midnight
  if (span < 0) return 0;

  const paused = breakSeconds(breaks);
  // A break longer than the shift is a data error, not negative work.
  return Math.max(0, span - paused);
}

/** Seconds → hours, 2 dp — what payroll multiplies by the hourly rate. */
export const toHours = (seconds: number): number => Math.round((seconds / HOUR) * 100) / 100;

/** "7:30" for a screen, from seconds. */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / HOUR);
  const m = Math.floor((s % HOUR) / 60);
  return `${h}:${String(m).padStart(2, "0")}`;
}

/**
 * Validate one day before it is stored. Returns an Arabic error or null. The ceiling is
 * deliberate: a 20-hour day is nearly always a forgotten clock-out from the day before,
 * and silently paying it is worse than refusing it.
 */
export function validateDay(input: { workDate: string; clockIn: string; clockOut?: string | null }): string | null {
  if (!input.workDate) return "التاريخ مطلوب";
  if (!input.clockIn) return "وقت الحضور مطلوب";
  const inAt = t(input.clockIn);
  if (inAt == null) return "وقت الحضور غير صالح";
  if (input.clockOut) {
    const outAt = t(input.clockOut);
    if (outAt == null) return "وقت الانصراف غير صالح";
    const seconds = workedSeconds({ clockIn: input.clockIn, clockOut: input.clockOut });
    if (seconds > 20 * HOUR) return "أكتر من ٢٠ ساعة في اليوم — غالباً نسي يسجّل انصراف";
  }
  const day = new Date(input.workDate);
  if (Number.isNaN(day.getTime())) return "التاريخ غير صالح";
  if (day.getTime() > Date.now() + 86_400_000) return "تاريخ في المستقبل";
  return null;
}

export type ImportedRow = {
  employeeCode: string;
  workDate: string;
  clockIn: string;
  clockOut: string | null;
  lineNumber: number;
};

/**
 * Parse a device export. Fingerprint machines all emit some flavour of
 * "code, date, in, out" — the header names vary, so columns are matched by position
 * after an optional header row, which is the only thing they agree on.
 *
 * Returns rows AND errors together: an import that silently drops the three rows it
 * couldn't read is how a month of payroll goes quietly wrong.
 */
export function parseAttendanceCsv(rows: string[][]): { rows: ImportedRow[]; errors: string[] } {
  const out: ImportedRow[] = [];
  const errors: string[] = [];
  if (!rows.length) return { rows: out, errors };

  // Skip a header row: it is the one whose date column doesn't parse as a date.
  const first = rows[0];
  const startAt = first && Number.isNaN(new Date(first[1] ?? "").getTime()) ? 1 : 0;

  for (let i = startAt; i < rows.length; i++) {
    const r = rows[i];
    const lineNumber = i + 1;
    if (!r || r.every((c) => !c?.trim())) continue;

    const [code, date, cin, cout] = [r[0]?.trim(), r[1]?.trim(), r[2]?.trim(), r[3]?.trim()];
    if (!code) { errors.push(`سطر ${lineNumber}: كود الموظف فاضي`); continue; }
    if (!date || Number.isNaN(new Date(date).getTime())) { errors.push(`سطر ${lineNumber}: تاريخ غير صالح`); continue; }
    if (!cin) { errors.push(`سطر ${lineNumber}: وقت الحضور فاضي`); continue; }

    const iso = new Date(date).toISOString().slice(0, 10);
    const stamp = (time: string) => (time.includes("T") ? time : `${iso}T${time.length === 5 ? `${time}:00` : time}`);
    const clockIn = stamp(cin);
    if (Number.isNaN(new Date(clockIn).getTime())) { errors.push(`سطر ${lineNumber}: وقت الحضور غير صالح`); continue; }
    let clockOut: string | null = null;
    if (cout) {
      const c = stamp(cout);
      if (Number.isNaN(new Date(c).getTime())) { errors.push(`سطر ${lineNumber}: وقت الانصراف غير صالح`); continue; }
      clockOut = c;
    }

    out.push({ employeeCode: code, workDate: iso, clockIn, clockOut, lineNumber });
  }
  return { rows: out, errors };
}
