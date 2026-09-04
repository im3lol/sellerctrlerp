import { describe, it, expect } from "vitest";
import { scoreSuppliers, onTimeScore, qualityScore, priceScore, ratingLabel } from "@/lib/erp/vendor-rating";

const receipt = (o: Partial<Parameters<typeof scoreSuppliers>[0][number]> = {}) => ({
  supplierId: "S1", expectedDate: "2026-01-10", receivedDate: "2026-01-10",
  acceptedQty: 100, rejectedQty: 0, ...o,
});

describe("individual scales", () => {
  it("scores punctuality, rewarding early the same as on time", () => {
    expect(onTimeScore(0)).toBe(100);
    expect(onTimeScore(-5)).toBe(100);
    expect(onTimeScore(7)).toBe(65);
    expect(onTimeScore(20)).toBe(0);
    expect(onTimeScore(200)).toBe(0);
  });

  it("scores quality off the reject share", () => {
    expect(qualityScore(0)).toBe(100);
    expect(qualityScore(0.05)).toBe(75);
    expect(qualityScore(0.2)).toBe(0);
  });

  it("scores price honesty off the overcharge share", () => {
    expect(priceScore(0)).toBe(100);
    expect(priceScore(0.02)).toBe(80);
    expect(priceScore(0.1)).toBe(0);
  });
});

describe("supplier scoring", () => {
  it("gives a perfect supplier 100 across the board", () => {
    const [s] = scoreSuppliers(
      [receipt(), receipt(), receipt()],
      [{ supplierId: "S1", orderedUnitPrice: 10, invoicedUnitPrice: 10, quantity: 100 }],
    );
    expect(s.onTime).toBe(100);
    expect(s.quality).toBe(100);
    expect(s.priceHonesty).toBe(100);
    expect(s.overall).toBe(100);
  });

  it("averages lateness across receipts", () => {
    const [s] = scoreSuppliers([
      receipt({ receivedDate: "2026-01-10" }), // on time
      receipt({ receivedDate: "2026-01-14" }), // 4 days
    ], []);
    expect(s.avgDaysLate).toBe(2);
    expect(s.onTime).toBe(90);
  });

  it("measures rejects against everything that arrived, not just what was accepted", () => {
    const [s] = scoreSuppliers([receipt({ acceptedQty: 90, rejectedQty: 10 })], []);
    expect(s.rejectRate).toBe(0.1);
    expect(s.quality).toBe(50);
  });

  it("weights overcharging by quantity", () => {
    const [s] = scoreSuppliers([], [
      { supplierId: "S1", orderedUnitPrice: 10, invoicedUnitPrice: 11, quantity: 1 },   // +10% on 1
      { supplierId: "S1", orderedUnitPrice: 10, invoicedUnitPrice: 10, quantity: 99 },  // fair on 99
    ]);
    expect(s.overchargeRate).toBe(0.001); // ≈0.1% weighted, not 5%
    expect(s.priceHonesty).toBe(99);
  });

  it("does not reward undercharging", () => {
    const [s] = scoreSuppliers([], [
      { supplierId: "S1", orderedUnitPrice: 10, invoicedUnitPrice: 5, quantity: 10 },
    ]);
    expect(s.overchargeRate).toBe(0);
    expect(s.priceHonesty).toBe(100);
  });

  it("re-weights around a dimension it cannot measure, instead of scoring it zero", () => {
    // Never invoiced: price is unknown, not bad. Overall is delivery+quality only.
    const [s] = scoreSuppliers([receipt({ acceptedQty: 90, rejectedQty: 10 })], []);
    expect(s.priceHonesty).toBeNull();
    expect(s.overall).toBe(r(100 * 40 / 75 + 50 * 35 / 75));
  });

  it("scores nothing when a receipt carried no promised date", () => {
    const [s] = scoreSuppliers([receipt({ expectedDate: null })], []);
    expect(s.onTime).toBeNull();
    expect(s.avgDaysLate).toBeNull();
    expect(s.sample.datedReceipts).toBe(0);
  });

  it("ranks best first and leaves the unscored at the bottom", () => {
    const rows = scoreSuppliers([
      receipt({ supplierId: "GOOD" }),
      receipt({ supplierId: "LATE", receivedDate: "2026-01-25" }),
      { supplierId: "NEW", expectedDate: null, receivedDate: "2026-01-10", acceptedQty: 0, rejectedQty: 0 },
    ], []);
    expect(rows.map((r) => r.supplierId)).toEqual(["GOOD", "LATE", "NEW"]);
    expect(rows[2].overall).toBeNull();
  });
});

describe("verdict", () => {
  const s = (overall: number, receipts = 5) =>
    ({ overall, sample: { receipts, datedReceipts: receipts, invoicedLines: 0 } } as Parameters<typeof ratingLabel>[0]);

  it("labels a scored supplier", () => {
    expect(ratingLabel(s(95))).toBe("ممتاز");
    expect(ratingLabel(s(80))).toBe("جيد");
    expect(ratingLabel(s(60))).toBe("مقبول");
    expect(ratingLabel(s(30))).toBe("ضعيف");
  });

  it("withholds a verdict while the sample is thin", () => {
    expect(ratingLabel(s(95, 2))).toBeNull();
    expect(ratingLabel(s(null as unknown as number))).toBeNull();
  });
});

const r = (n: number) => Math.round(n * 10) / 10;
