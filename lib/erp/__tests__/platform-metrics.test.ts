import { describe, it, expect } from "vitest";
import { normalizeMrr, isLiveRevenue, classifyOrg } from "@/lib/erp/platform-metrics";

const now = new Date("2026-07-18T00:00:00Z");
const future = new Date("2026-12-01T00:00:00Z");
const past = new Date("2026-01-01T00:00:00Z");

describe("normalizeMrr", () => {
  it("keeps a monthly price as-is", () => expect(normalizeMrr(1750, "MONTHLY")).toBe(1750));
  it("divides an annual price by 12", () => expect(normalizeMrr(31200, "ANNUAL")).toBe(2600));
  it("treats null interval as monthly", () => expect(normalizeMrr(800, null)).toBe(800));
  it("handles zero/garbage", () => expect(normalizeMrr(0, "ANNUAL")).toBe(0));
});

describe("isLiveRevenue", () => {
  it("live ACTIVE not expired = revenue", () => expect(isLiveRevenue("ACTIVE", future, now)).toBe(true));
  it("ACTIVE with no expiry = revenue", () => expect(isLiveRevenue("ACTIVE", null, now)).toBe(true));
  it("ACTIVE past expiry = NOT revenue", () => expect(isLiveRevenue("ACTIVE", past, now)).toBe(false));
  it("TRIAL is never revenue", () => expect(isLiveRevenue("TRIAL", future, now)).toBe(false));
});

describe("classifyOrg", () => {
  const orgCreatedAt = new Date("2026-01-01T00:00:00Z"); // old org (past trial)
  it("active ANNUAL contributes normalized mrr", () => {
    expect(classifyOrg({ status: "ACTIVE", interval: "ANNUAL", price: "31200", expiresAt: future, orgCreatedAt }, now))
      .toEqual({ bucket: "active", mrr: 2600 });
  });
  it("ACTIVE past expiry falls to expired, 0 mrr", () => {
    expect(classifyOrg({ status: "ACTIVE", interval: "MONTHLY", price: "1750", expiresAt: past, orgCreatedAt }, now))
      .toEqual({ bucket: "expired", mrr: 0 });
  });
  it("no subscription row on a NEW org = trial", () => {
    const freshOrg = new Date(now.getTime() - 3 * 86_400_000); // 3 days old
    expect(classifyOrg({ status: null, interval: null, price: null, expiresAt: null, orgCreatedAt: freshOrg }, now).bucket).toBe("trial");
  });
  it("no subscription row on an OLD org = expired (trial lapsed)", () => {
    expect(classifyOrg({ status: null, interval: null, price: null, expiresAt: null, orgCreatedAt }, now).bucket).toBe("expired");
  });
  it("CANCELLED is its own bucket, 0 mrr", () => {
    expect(classifyOrg({ status: "CANCELLED", interval: "MONTHLY", price: "800", expiresAt: future, orgCreatedAt }, now))
      .toEqual({ bucket: "cancelled", mrr: 0 });
  });
});
