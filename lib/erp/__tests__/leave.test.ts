import { describe, it, expect } from "vitest";
import { leaveDays } from "@/lib/erp/leave";

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
