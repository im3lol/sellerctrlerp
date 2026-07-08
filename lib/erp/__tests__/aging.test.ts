import { describe, it, expect } from "vitest";
import { bucketOf, buildAging, type OpenDoc } from "../aging";

const asOf = new Date("2026-06-30T23:59:59");
const d = (s: string) => new Date(s);

describe("bucketOf", () => {
  it("future or same-day due dates are current", () => {
    expect(bucketOf(d("2026-07-15"), d("2026-01-01"), asOf)).toBe("current");
    expect(bucketOf(d("2026-06-30"), d("2026-01-01"), asOf)).toBe("current");
  });
  it("buckets by days overdue", () => {
    expect(bucketOf(d("2026-06-20"), d("2000-01-01"), asOf)).toBe("d30");   // ~10 days
    expect(bucketOf(d("2026-05-20"), d("2000-01-01"), asOf)).toBe("d60");   // ~41 days
    expect(bucketOf(d("2026-04-20"), d("2000-01-01"), asOf)).toBe("d90");   // ~71 days
    expect(bucketOf(d("2026-01-01"), d("2000-01-01"), asOf)).toBe("d90plus"); // ~180 days
  });
  it("falls back to the document date when there is no due date", () => {
    expect(bucketOf(null, d("2026-06-20"), asOf)).toBe("d30");
    expect(bucketOf(null, d("2026-07-10"), asOf)).toBe("current");
  });
});

describe("buildAging", () => {
  const mk = (partyId: string, balanceDue: number, dueDate: string | null): OpenDoc => ({
    partyId, partyCode: partyId, partyName: partyId, date: d("2026-06-01"),
    dueDate: dueDate ? d(dueDate) : null, balanceDue,
  });

  it("skips non-positive balances and aggregates per party", () => {
    const { rows, totals, grand } = buildAging(
      [mk("A", 100, "2026-06-20"), mk("A", 50, "2026-04-20"), mk("B", 200, "2026-07-15"), mk("A", 0, "2026-01-01"), mk("B", -10, "2026-01-01")],
      asOf,
    );
    expect(rows).toHaveLength(2);
    const a = rows.find((r) => r.partyId === "A")!;
    expect(a.total).toBe(150);
    expect(a.buckets.d30).toBe(100);
    expect(a.buckets.d90).toBe(50);
    const b = rows.find((r) => r.partyId === "B")!;
    expect(b.buckets.current).toBe(200);
    expect(totals.d30).toBe(100);
    expect(grand).toBe(350);
  });

  it("sorts parties by total descending", () => {
    const { rows } = buildAging([mk("small", 10, null), mk("big", 999, null)], asOf);
    expect(rows[0].partyId).toBe("big");
  });

  it("empty input yields zero totals", () => {
    const { rows, grand } = buildAging([], asOf);
    expect(rows).toHaveLength(0);
    expect(grand).toBe(0);
  });
});
