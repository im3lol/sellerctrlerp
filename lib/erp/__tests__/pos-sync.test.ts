import { describe, it, expect } from "vitest";
import {
  newClientRef, canQueueOffline, enqueue, markSynced, markFailed, retry, discard,
  pending, failed, unsettledCount, drawerAdjustment, prune, syncOrder,
  type QueuedSale,
} from "@/lib/erp/pos-sync";

const sale = (clientRef: string, over: Partial<QueuedSale> = {}): QueuedSale => ({
  clientRef,
  soldAt: over.soldAt ?? "2026-09-05T10:00:00.000Z",
  shiftId: "sh1",
  customerId: "c1",
  lines: [{ itemId: "i1", label: "صنف", quantity: 1, unitPrice: 100, discount: 0 }],
  payments: [{ method: "CASH", amount: 100 }],
  applyVat: false,
  vatRate: 0,
  total: 100,
  status: "PENDING",
  attempts: 0,
  ...over,
});

describe("the idempotency key", () => {
  it("is different every time — two sales never collide", () => {
    const refs = new Set(Array.from({ length: 200 }, newClientRef));
    expect(refs.size).toBe(200);
  });
});

describe("what may be sold offline", () => {
  it("takes cash and card", () => {
    expect(canQueueOffline({ lines: sale("a").lines, payments: [{ method: "CASH", amount: 50 }, { method: "CARD", amount: 50 }] })).toBeNull();
  });

  it("refuses anything that needs a live customer balance", () => {
    const err = canQueueOffline({ lines: sale("a").lines, payments: [{ method: "WALLET", amount: 100 }] });
    expect(err).toMatch(/كاش أو بطاقة/);
  });

  it("refuses an empty cart or a sale with no payment", () => {
    expect(canQueueOffline({ lines: [], payments: sale("a").payments })).toMatch(/فاضية/);
    expect(canQueueOffline({ lines: sale("a").lines, payments: [] })).toMatch(/طريقة دفع/);
  });
});

describe("the queue", () => {
  it("ignores a second enqueue of the same key — that is the whole point of the key", () => {
    const q = enqueue(enqueue([], sale("r1")), sale("r1"));
    expect(q).toHaveLength(1);
  });

  it("replays oldest first", () => {
    const q = [sale("late", { soldAt: "2026-09-05T12:00:00.000Z" }), sale("early", { soldAt: "2026-09-05T08:00:00.000Z" })];
    expect(syncOrder(q).map((s) => s.clientRef)).toEqual(["early", "late"]);
  });

  it("only replays pending sales", () => {
    const q = [sale("a"), sale("b", { status: "SYNCED" }), sale("c", { status: "FAILED" })];
    expect(syncOrder(q).map((s) => s.clientRef)).toEqual(["a"]);
  });
});

describe("a sale that cannot post", () => {
  it("stays in the queue as a visible exception, it does not disappear", () => {
    const q = markFailed(enqueue([], sale("r1")), "r1", "الرصيد مش كفاية");
    expect(q).toHaveLength(1);
    expect(failed(q)[0].error).toBe("الرصيد مش كفاية");
    expect(pending(q)).toHaveLength(0);
  });

  it("counts attempts so the UI can stop retrying a hopeless sale", () => {
    let q = enqueue([], sale("r1"));
    q = markFailed(q, "r1", "خطأ");
    q = markFailed(q, "r1", "خطأ");
    expect(failed(q)[0].attempts).toBe(2);
  });

  it("goes back in line once someone fixes the cause", () => {
    let q = markFailed(enqueue([], sale("r1")), "r1", "خطأ");
    q = retry(q, "r1");
    expect(pending(q)).toHaveLength(1);
    expect(pending(q)[0].error).toBeNull();
    expect(pending(q)[0].attempts).toBe(1); // history is not erased
  });

  it("leaves the queue only when a human discards it", () => {
    const q = discard(markFailed(enqueue([], sale("r1")), "r1", "خطأ"), "r1");
    expect(q).toHaveLength(0);
  });
});

describe("the drawer", () => {
  it("counts unsynced sales as money in the till — otherwise offline reads as a shortage", () => {
    const q = [
      sale("a", { payments: [{ method: "CASH", amount: 100 }], total: 100 }),
      sale("b", { payments: [{ method: "CARD", amount: 250 }], total: 250 }),
      sale("c", { payments: [{ method: "CASH", amount: 40 }, { method: "CARD", amount: 60 }], total: 100 }),
    ];
    const d = drawerAdjustment(q);
    expect(d.cash).toBe(140);
    expect(d.card).toBe(310);
    expect(d.sales).toBe(450);
  });

  it("stops counting a sale the server has taken over", () => {
    const q = [sale("a"), sale("b", { status: "SYNCED" })];
    expect(drawerAdjustment(q).cash).toBe(100);
  });

  it("still counts a failed sale — the money is in the drawer either way", () => {
    expect(drawerAdjustment([sale("a", { status: "FAILED" })]).cash).toBe(100);
    expect(unsettledCount([sale("a", { status: "FAILED" }), sale("b", { status: "SYNCED" })])).toBe(1);
  });
});

describe("pruning", () => {
  it("clears old synced sales and never touches an unsettled one", () => {
    const q = [
      ...Array.from({ length: 25 }, (_, i) => sale(`s${i}`, { status: "SYNCED" as const })),
      sale("pending-one"),
      sale("failed-one", { status: "FAILED" }),
    ];
    const p = prune(q, 20);
    expect(p.filter((s) => s.status === "SYNCED")).toHaveLength(20);
    expect(p.some((s) => s.clientRef === "pending-one")).toBe(true);
    expect(p.some((s) => s.clientRef === "failed-one")).toBe(true);
  });

  it("does nothing when there is little to clear", () => {
    const q = [sale("a", { status: "SYNCED" })];
    expect(prune(q, 20)).toBe(q);
  });
});
