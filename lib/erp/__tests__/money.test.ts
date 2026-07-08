import { describe, it, expect } from "vitest";
import { round2, round4 } from "../money";

describe("round2", () => {
  it("rounds to 2 decimals", () => {
    expect(round2(1.005)).toBe(1.0); // JS float: 1.005*100 = 100.499… → 100
    expect(round2(2.345)).toBe(2.35);
    expect(round2(10)).toBe(10);
    expect(round2(0.1 + 0.2)).toBe(0.3);
  });
});

describe("round4", () => {
  it("rounds to 4 decimals", () => {
    expect(round4(1.23456)).toBe(1.2346);
    expect(round4(5)).toBe(5);
  });
});
