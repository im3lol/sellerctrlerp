import { describe, it, expect } from "vitest";
import { paced } from "./client";

describe("paced", () => {
  it("serializes calls per key and spaces their starts by minInterval", async () => {
    const starts: number[] = [];
    const t0 = Date.now();
    const call = () => paced("k", 50, async () => { starts.push(Date.now() - t0); });
    await Promise.all([call(), call(), call()]);
    // three calls paced by 50ms → starts near 0, 50, 100 (allow slack)
    expect(starts).toHaveLength(3);
    expect(starts[1]).toBeGreaterThanOrEqual(45);
    expect(starts[2]).toBeGreaterThanOrEqual(95);
  });

  it("keeps different keys independent", async () => {
    const t0 = Date.now();
    const at: number[] = [];
    await Promise.all([
      paced("a", 200, async () => at.push(Date.now() - t0)),
      paced("b", 200, async () => at.push(Date.now() - t0)),
    ]);
    // both run immediately (different keys) — neither waits on the other
    expect(Math.max(...at)).toBeLessThan(150);
  });
});
