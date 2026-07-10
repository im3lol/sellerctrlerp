import { describe, it, expect } from "vitest";
import { leaveDays, workingDays } from "@/lib/erp/leave";

describe("leaveDays", () => {
  it("counts both ends inclusively", () => {
    expect(leaveDays("2026-07-10", "2026-07-10")).toBe(1);
    expect(leaveDays("2026-07-10", "2026-07-12")).toBe(3);
  });
  it("spans month/DST boundaries by whole calendar days", () => {
    expect(leaveDays("2026-01-30", "2026-02-02")).toBe(4);
  });
  it("returns 0 for a reversed or invalid range", () => {
    expect(leaveDays("2026-07-12", "2026-07-10")).toBe(0);
    expect(leaveDays("", "2026-07-10")).toBe(0);
  });
});

describe("workingDays", () => {
  // 2026-01-01 is Thursday → Jan 2 Fri, Jan 3 Sat (Egypt weekend), Jan 5 Mon.
  it("excludes Fri/Sat weekend days", () => {
    expect(workingDays("2026-01-05", "2026-01-11")).toBe(5); // Mon-Sun minus Fri9,Sat10
    expect(workingDays("2026-01-02", "2026-01-03")).toBe(0); // Fri+Sat
  });
  it("also excludes listed holidays", () => {
    expect(workingDays("2026-01-05", "2026-01-11", ["2026-01-05"])).toBe(4);
  });
  it("returns 0 for a reversed range", () => {
    expect(workingDays("2026-01-11", "2026-01-05")).toBe(0);
  });
});
