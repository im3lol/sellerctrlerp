import { describe, it, expect } from "vitest";
import { classifyAudit } from "../inventory-audit";
import type { MarketplaceInventoryDetail } from "../dto";

// Zero-filled detail helper; override the fields a case cares about.
const det = (o: Partial<MarketplaceInventoryDetail>): MarketplaceInventoryDetail => ({
  code: "SKU", title: "", total: 0, fulfillable: 0, inboundWorking: 0, inboundShipped: 0, inboundReceiving: 0,
  reservedTotal: 0, reservedCustomerOrder: 0, reservedTransshipment: 0, reservedFcProcessing: 0,
  unfulfillableTotal: 0, warehouseDamaged: 0, customerDamaged: 0, carrierDamaged: 0, distributorDamaged: 0,
  defective: 0, expired: 0, researching: 0, ...o,
});

describe("classifyAudit — matches the user's reconciliation examples", () => {
  it("A001: ERP 100, Amazon total 100 (95 avail + 3 reserved + 2 receiving) → MATCHED", () => {
    const row = classifyAudit(det({ total: 100, fulfillable: 95, reservedTotal: 3, inboundReceiving: 2 }), "i1", 100);
    expect(row.status).toBe("MATCHED");
    expect(row.diff).toBe(0);
  });
  it("A002: ERP 80, Amazon total 80 (77 avail + 3 damaged) → DAMAGED", () => {
    const row = classifyAudit(det({ total: 80, fulfillable: 77, unfulfillableTotal: 3, warehouseDamaged: 3 }), "i2", 80);
    expect(row.status).toBe("DAMAGED");
    expect(row.damaged).toBe(3);
  });
  it("A003: ERP 40, Amazon total 39 → LOST (1 missing)", () => {
    const row = classifyAudit(det({ total: 39, fulfillable: 39 }), "i3", 40);
    expect(row.status).toBe("LOST");
    expect(row.diff).toBe(1);
  });
  it("BUG: ERP 100, Amazon total 90 (80 avail + 10 damaged) → LOST, not DAMAGED (10 units missing on top of damage)", () => {
    const row = classifyAudit(det({ total: 90, fulfillable: 80, unfulfillableTotal: 10, warehouseDamaged: 10 }), "i6", 100);
    expect(row.status).toBe("LOST"); // the 10-unit shortfall must drive an adjustment, not be masked by the damaged flag
    expect(row.diff).toBe(10);
    expect(row.damaged).toBe(10);    // damage still surfaced in its column
  });
  it("untracked SKU (erpQty 0) with only damaged units → still DAMAGED (no shortfall)", () => {
    expect(classifyAudit(det({ total: 5, unfulfillableTotal: 5, warehouseDamaged: 5 }), "i7", 0).status).toBe("DAMAGED");
  });
  it("shortfall while Amazon is researching → RESEARCHING wins (don't write off yet)", () => {
    expect(classifyAudit(det({ total: 90, fulfillable: 90, researching: 10 }), "i8", 100).status).toBe("RESEARCHING");
  });
  it("Amazon holds more than ERP with inbound → RECEIVING", () => {
    expect(classifyAudit(det({ total: 100, fulfillable: 98, inboundReceiving: 2 }), "i4", 98).status).toBe("RECEIVING");
  });
  it("Amazon holds more than ERP, no inbound → FOUND", () => {
    expect(classifyAudit(det({ total: 5, fulfillable: 5 }), "i5", 3).status).toBe("FOUND");
  });
  it("no matching item → UNMATCHED", () => {
    expect(classifyAudit(det({ total: 10 }), null, 0).status).toBe("UNMATCHED");
  });
});
