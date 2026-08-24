import { describe, it, expect } from "vitest";
import { intervalFromRateHeader } from "../client";

describe("intervalFromRateHeader — x-amzn-RateLimit-Limit → pacing interval (ms)", () => {
  it("rate → 1000/rate ms", () => {
    expect(intervalFromRateHeader("1")).toBe(1000);   // 1 req/s
    expect(intervalFromRateHeader("2")).toBe(500);    // 2 req/s
    expect(intervalFromRateHeader("0.5")).toBe(2000); // 0.5 req/s
  });
  it("absent/unparseable → null (fall back to the static floor)", () => {
    expect(intervalFromRateHeader(null)).toBeNull();
    expect(intervalFromRateHeader("")).toBeNull();
    expect(intervalFromRateHeader("abc")).toBeNull();
    expect(intervalFromRateHeader("0")).toBeNull();
    expect(intervalFromRateHeader("-1")).toBeNull();
  });
  it("clamps: a very high rate floors at 60ms, a tiny rate caps at 65s", () => {
    expect(intervalFromRateHeader("1000")).toBe(60);      // 1000/s → 1ms clamped up to 60ms
    expect(intervalFromRateHeader("0.001")).toBe(65_000); // 1000s → clamped down to 65s
  });
});
