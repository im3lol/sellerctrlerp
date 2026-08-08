import { describe, it, expect } from "vitest";
import { mapNoonReturn } from "../returns";
import { emptyTxn, settlementDedupKey } from "@/lib/erp/amazon-settlement";

describe("mapNoonReturn — defensive FBPI return mapping", () => {
  it("maps one row per line with order + sku + qty", () => {
    const rows = mapNoonReturn({
      fbpi_return_nr: "R-1", fbpi_order_nr: "O-9", created_at: "2026-08-01T10:00:00Z",
      items: [
        { partner_sku: "SKU-A", qty: 2, reason: "damaged", condition: "DAMAGED" },
        { sku: "SKU-B", return_qty: 1 },
      ],
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ orderId: "O-9", sku: "SKU-A", quantity: 2, disposition: "DAMAGED" });
    expect(rows[1]).toMatchObject({ orderId: "O-9", sku: "SKU-B", quantity: 1 });
    expect(rows[0].returnDate?.toISOString()).toBe("2026-08-01T10:00:00.000Z");
  });

  it("skips a line with no sku or no order (never guesses)", () => {
    expect(mapNoonReturn({ order_nr: "O-1", items: [{ qty: 1 }] })).toHaveLength(0); // no sku
    expect(mapNoonReturn({ items: [{ sku: "S", qty: 1 }] })).toHaveLength(0);        // no order
  });

  it("dedupKey is stable + line-distinct (idempotent re-delivery)", () => {
    const a = mapNoonReturn({ return_nr: "R-2", order_nr: "O-2", items: [{ sku: "S1", qty: 1 }, { sku: "S2", qty: 1 }] });
    const b = mapNoonReturn({ return_nr: "R-2", order_nr: "O-2", items: [{ sku: "S1", qty: 1 }, { sku: "S2", qty: 1 }] });
    expect(a[0].dedupKey).toBe(b[0].dedupKey);   // same payload → same key → upsert dedups
    expect(a[0].dedupKey).not.toBe(a[1].dedupKey); // different line → different key
  });
});

describe("Noon manual transfer → settlement Transfer row", () => {
  // Mirrors how recordNoonTransferAction builds the row.
  const build = (ref: string, amount: number) => {
    const t = emptyTxn(ref, "Transfer");
    t.total = -amount; // outbound
    return t;
  };

  it("is an outbound Transfer (total negative) so the poster credits the wallet / debits the bank", () => {
    const t = build("DEP-1", 500);
    expect(t.type).toBe("Transfer");
    expect(t.total).toBe(-500); // aggregateGL: bank += -total = +500, clearing += total = -500
    // a Transfer carries no sales/fees — it must never touch revenue or fee accounts
    expect(t.productSales + t.sellingFees + t.fbaFees + t.otherTransactionFees).toBe(0);
  });

  it("dedupKey is deterministic for the same (ref, amount)", () => {
    expect(settlementDedupKey(build("DEP-2", 300))).toBe(settlementDedupKey(build("DEP-2", 300)));
    expect(settlementDedupKey(build("DEP-2", 300))).not.toBe(settlementDedupKey(build("DEP-3", 300)));
  });
});
