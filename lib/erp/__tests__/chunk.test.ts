import { describe, it, expect } from "vitest";
import { chunk } from "../chunk";

describe("chunk", () => {
  it("splits into slices of at most size, preserving order + count", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 3)).toEqual([]);
    // 11.7k rows at 500 → 24 slices, none over the size, total preserved.
    const big = Array.from({ length: 11695 }, (_, i) => i);
    const slices = chunk(big, 500);
    expect(slices).toHaveLength(24);
    expect(slices.every((s) => s.length <= 500)).toBe(true);
    expect(slices.flat()).toHaveLength(11695);
  });
  it("rejects a non-positive size", () => {
    expect(() => chunk([1], 0)).toThrow();
  });
});
