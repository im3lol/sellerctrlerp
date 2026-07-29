import { describe, it, expect } from "vitest";
import { unwrapXpay, isPaidStatus } from "../xpay";

describe("unwrapXpay", () => {
  it("returns data on a 2xx status code", () => {
    const data = unwrapXpay<{ total_amount: number }>({ status: { code: 200, message: "success", errors: [] }, data: { total_amount: 53.36 } });
    expect(data.total_amount).toBe(53.36);
  });

  it("throws with the message/errors on a non-2xx code", () => {
    expect(() => unwrapXpay({ status: { code: 400, message: "", errors: [{ billing_data: { name: ["bad"] } }] }, data: {} }))
      .toThrow(/xpay 400/);
  });

  it("throws when the envelope has no valid status code", () => {
    expect(() => unwrapXpay({})).toThrow(/xpay 0/);
  });
});

describe("isPaidStatus", () => {
  it("accepts successful states case-insensitively", () => {
    for (const s of ["SUCCESSFUL", "success", "Paid", "COMPLETED"]) expect(isPaidStatus(s)).toBe(true);
  });
  it("rejects pending/failed/empty", () => {
    for (const s of ["PENDING", "FAILED", "", null, undefined]) expect(isPaidStatus(s)).toBe(false);
  });
});
