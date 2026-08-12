import { describe, it, expect } from "vitest";
import { computePushUpdates } from "../inventory-push";

describe("computePushUpdates", () => {
  it("pushes only SKUs whose channel qty differs from ERP available", () => {
    const erp = [{ code: "A", available: 3 }, { code: "B", available: 5 }, { code: "C", available: 0 }];
    const channel = [{ code: "A", onHand: 5 }, { code: "B", onHand: 5 }, { code: "C", onHand: 2 }];
    // A: 5→3 (changed), B: 5→5 (skip), C: 2→0 (changed, stock-out)
    expect(computePushUpdates(erp, channel)).toEqual([{ code: "A", available: 3 }, { code: "C", available: 0 }]);
  });

  it("ignores SKUs not listed on the channel (inventory push updates existing listings only)", () => {
    const erp = [{ code: "A", available: 4 }, { code: "NEW", available: 9 }];
    const channel = [{ code: "A", onHand: 4 }]; // NEW isn't listed here
    expect(computePushUpdates(erp, channel)).toEqual([]); // A matches, NEW skipped
  });

  it("clamps to a non-negative integer (channels reject negatives/fractions)", () => {
    const erp = [{ code: "A", available: -2 }, { code: "B", available: 3.9 }];
    const channel = [{ code: "A", onHand: 5 }, { code: "B", onHand: 5 }];
    expect(computePushUpdates(erp, channel)).toEqual([{ code: "A", available: 0 }, { code: "B", available: 3 }]);
  });
});
