import { describe, it, expect } from "vitest";
import { parseStuckDays, STUCK_RULES } from "@/lib/erp/approval-policy";

describe("parseStuckDays", () => {
  it("gives every rule its default when the company set nothing", () => {
    const d = parseStuckDays(null);
    for (const r of STUCK_RULES) expect(d[r.key]).toBe(r.def);
  });

  it("keeps what the company set — 0 included — and defaults the rest", () => {
    const d = parseStuckDays({ enabled: true, stuck: { so: 5, po: 0, je: "10" } });
    expect(d.so).toBe(5);
    expect(d.po).toBe(0);
    expect(d.je).toBe(10);
    expect(d.dn).toBe(2);
  });

  it("ignores nonsense, drops fractions and caps at a year", () => {
    const d = parseStuckDays({ stuck: { so: -3, dn: "abc", si: 9999, ret: 2.7 } });
    expect(d.so).toBe(3);
    expect(d.dn).toBe(2);
    expect(d.si).toBe(365);
    expect(d.ret).toBe(2);
  });
});
