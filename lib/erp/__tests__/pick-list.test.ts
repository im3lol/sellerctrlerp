import { describe, it, expect } from "vitest";
import { groupForPicking, allocatePicked, readyDeliveries, type PickLine } from "@/lib/erp/pick-list";

const line = (o: Partial<PickLine>): PickLine => ({ id: "l", deliveryId: "d", itemId: "i", qty: 1, picked: 0, binCode: null, ...o });

describe("groupForPicking", () => {
  it("adds up each item across deliveries and walks the bins in order, bin-less last", () => {
    const g = groupForPicking([
      line({ id: "1", deliveryId: "d1", itemId: "pen", qty: 2, binCode: "A-10" }),
      line({ id: "2", deliveryId: "d2", itemId: "pen", qty: 3, binCode: "A-10" }),
      line({ id: "3", deliveryId: "d1", itemId: "cup", qty: 1, binCode: "A-2" }),
      line({ id: "4", deliveryId: "d2", itemId: "box", qty: 4 }),
    ]);
    expect(g.map((x) => [x.itemId, x.required])).toEqual([["cup", 1], ["pen", 5], ["box", 4]]);
  });
});

describe("allocatePicked", () => {
  it("fills the oldest delivery first, so a short pick completes whole deliveries", () => {
    const lines = [
      { id: "old", itemId: "pen", qty: 3 },
      { id: "new", itemId: "pen", qty: 3 },
    ];
    const a = allocatePicked(lines, new Map([["pen", 4]]));
    expect(a.get("old")).toBe(3);
    expect(a.get("new")).toBe(1);
  });

  it("never gives a line more than it needs, and nothing that wasn't picked", () => {
    const a = allocatePicked([{ id: "x", itemId: "pen", qty: 2 }, { id: "y", itemId: "cup", qty: 1 }], new Map([["pen", 9]]));
    expect(a.get("x")).toBe(2);
    expect(a.get("y")).toBe(0);
  });
});

describe("readyDeliveries", () => {
  it("a delivery is ready only when every one of its lines is picked", () => {
    const ready = readyDeliveries([
      { deliveryId: "d1", qty: 2, picked: 2 },
      { deliveryId: "d1", qty: 1, picked: 1 },
      { deliveryId: "d2", qty: 3, picked: 2 },
    ]);
    expect([...ready]).toEqual(["d1"]);
  });
});
