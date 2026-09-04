import { describe, it, expect } from "vitest";
import {
  workedSeconds, breakSeconds, toHours, formatDuration, validateDay, parseAttendanceCsv,
} from "@/lib/erp/attendance";

const D = "2026-03-15";
const at = (hhmm: string) => `${D}T${hhmm}:00.000Z`;

describe("worked time", () => {
  it("subtracts the clock-in from the clock-out", () => {
    expect(workedSeconds({ clockIn: at("09:00"), clockOut: at("17:00") })).toBe(8 * 3600);
  });

  it("counts a night shift that crosses midnight as forward time, not negative", () => {
    expect(workedSeconds({ clockIn: at("22:00"), clockOut: at("06:00") })).toBe(8 * 3600);
  });

  it("gives an open day zero — unknown hours are not guessed", () => {
    expect(workedSeconds({ clockIn: at("09:00"), clockOut: null })).toBe(0);
    expect(workedSeconds({ clockIn: at("09:00") })).toBe(0);
  });

  it("takes closed breaks out of the shift", () => {
    const breaks = [{ start: at("12:00"), end: at("13:00") }];
    expect(workedSeconds({ clockIn: at("09:00"), clockOut: at("17:00") }, breaks)).toBe(7 * 3600);
  });

  it("ignores a break still running", () => {
    const breaks = [{ start: at("12:00"), end: null }];
    expect(workedSeconds({ clockIn: at("09:00"), clockOut: at("17:00") }, breaks)).toBe(8 * 3600);
  });

  it("never returns negative work when the breaks exceed the shift", () => {
    const breaks = [{ start: at("09:00"), end: at("20:00") }];
    expect(workedSeconds({ clockIn: at("09:00"), clockOut: at("17:00") }, breaks)).toBe(0);
  });
});

describe("break time", () => {
  it("adds up closed breaks and skips broken ones", () => {
    expect(breakSeconds([
      { start: at("12:00"), end: at("12:30") },
      { start: at("15:00"), end: null },              // still on break
      { start: at("16:00"), end: at("15:00") },       // end before start — junk
    ])).toBe(30 * 60);
    expect(breakSeconds([])).toBe(0);
    expect(breakSeconds(null)).toBe(0);
  });
});

describe("presentation", () => {
  it("converts to payable hours at 2 dp", () => {
    expect(toHours(8 * 3600)).toBe(8);
    expect(toHours(7.5 * 3600)).toBe(7.5);
    expect(toHours(1234)).toBe(0.34);
  });

  it("formats as h:mm", () => {
    expect(formatDuration(7.5 * 3600)).toBe("7:30");
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(-5)).toBe("0:00");
  });
});

describe("day validation", () => {
  it("accepts an ordinary day", () => {
    expect(validateDay({ workDate: D, clockIn: at("09:00"), clockOut: at("17:00") })).toBeNull();
  });

  it("accepts a day still open", () => {
    expect(validateDay({ workDate: D, clockIn: at("09:00") })).toBeNull();
  });

  it("refuses a day over twenty hours — a forgotten clock-out, not a shift", () => {
    expect(validateDay({ workDate: D, clockIn: at("01:00"), clockOut: at("23:30") })).toMatch(/٢٠ ساعة/);
  });

  it("refuses missing or unparseable input", () => {
    expect(validateDay({ workDate: "", clockIn: at("09:00") })).toMatch(/التاريخ/);
    expect(validateDay({ workDate: D, clockIn: "" })).toMatch(/الحضور/);
    expect(validateDay({ workDate: D, clockIn: "not-a-time" })).toMatch(/غير صالح/);
  });

  it("refuses a date in the future", () => {
    const next = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
    expect(validateDay({ workDate: next, clockIn: `${next}T09:00:00Z` })).toMatch(/المستقبل/);
  });
});

describe("device import", () => {
  it("reads code, date, in, out and skips the header", () => {
    const { rows, errors } = parseAttendanceCsv([
      ["code", "date", "in", "out"],
      ["EMP-1", "2026-03-15", "09:00", "17:00"],
      ["EMP-2", "2026-03-15", "10:00", ""],
    ]);
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows[0].employeeCode).toBe("EMP-1");
    expect(rows[0].workDate).toBe("2026-03-15");
    expect(rows[0].clockIn).toContain("09:00");
    expect(rows[1].clockOut).toBeNull();
  });

  it("reads a file with no header row at all", () => {
    const { rows } = parseAttendanceCsv([["EMP-1", "2026-03-15", "09:00", "17:00"]]);
    expect(rows).toHaveLength(1);
  });

  it("reports bad rows instead of dropping them silently", () => {
    const { rows, errors } = parseAttendanceCsv([
      ["EMP-1", "2026-03-15", "09:00", "17:00"],
      ["", "2026-03-15", "09:00", "17:00"],
      ["EMP-3", "not-a-date", "09:00", "17:00"],
      ["EMP-4", "2026-03-15", "", ""],
    ]);
    expect(rows).toHaveLength(1);
    expect(errors).toHaveLength(3);
    expect(errors[0]).toContain("سطر 2");
    expect(errors[1]).toContain("سطر 3");
    expect(errors[2]).toContain("سطر 4");
  });

  it("ignores fully blank lines", () => {
    const { rows, errors } = parseAttendanceCsv([
      ["EMP-1", "2026-03-15", "09:00", "17:00"],
      ["", "", "", ""],
    ]);
    expect(rows).toHaveLength(1);
    expect(errors).toEqual([]);
  });
});
