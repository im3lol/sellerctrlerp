import { describe, it, expect } from "vitest";
import { advance } from "@/lib/erp/recurring-shared";

// Local Y-M-D (advance uses local setMonth/setDate; avoid UTC ISO to dodge TZ shifts).
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

describe("advance (recurring next-run)", () => {
  it("weekly = +7 days", () => {
    expect(ymd(advance(new Date(2026, 0, 1), "WEEKLY"))).toBe("2026-01-08");
  });
  it("monthly = +1 month", () => {
    expect(ymd(advance(new Date(2026, 0, 15), "MONTHLY"))).toBe("2026-02-15");
  });
  it("quarterly = +3 months, short month rolls forward", () => {
    expect(ymd(advance(new Date(2026, 0, 31), "QUARTERLY"))).toBe("2026-05-01"); // Jan 31 → Apr 31 → May 1
  });
  it("yearly = +1 year", () => {
    expect(ymd(advance(new Date(2026, 2, 10), "YEARLY"))).toBe("2027-03-10");
  });
  it("does not mutate the input date", () => {
    const from = new Date(2026, 5, 1);
    advance(from, "MONTHLY");
    expect(ymd(from)).toBe("2026-06-01");
  });
});
