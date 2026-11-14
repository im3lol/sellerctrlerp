import { describe, it, expect } from "vitest";
import { canExportDataset, purchaseOrderForCaller, purchaseRowsForCaller } from "../data-access";
import type { ErpPermission } from "../permissions";
const can = (...permissions: ErpPermission[]) => (p: ErpPermission) => permissions.includes(p);
const detail = { id: "po", number: "PO-1", party: "supplier", date: "2026-10-18", status: "CONFIRMED", total: 500, lines: [{ name: "item", qty: 2, unitPrice: 250, total: 500 }] };
describe("warehouse cost redaction", () => {
  it("retains operational quantities without prices or newly added financial fields", () => {
    const extended = { ...detail, secretCost: 600 };
    const result = purchaseOrderForCaller(extended, can("purchases.view", "purchases.receive"));
    expect(result).toEqual({ ...detail, total: null, lines: [{ name: "item", qty: 2, unitPrice: null, total: null }] });
    expect(detail.total).toBe(500);
  });
  it("retains costs for purchasing and accounting, but not generic reports permission", () => {
    expect(purchaseOrderForCaller(detail, can("purchases.create"))).toBe(detail);
    expect(purchaseOrderForCaller(detail, can("accounting.view"))).toBe(detail);
    expect(purchaseOrderForCaller(detail, can("reports.view"))).toMatchObject({ total: null });
  });
  it("hides amounts on list cards without changing their identity or quantity subtitle", () => {
    const rows = [{ id: "m", number: "M-1", title: "item", subtitle: "qty 2", amount: 500, status: "IN" }];
    expect(purchaseRowsForCaller(rows, can("inventory.view"))).toEqual([{ ...rows[0], amount: null }]);
    expect(rows[0].amount).toBe(500);
  });
  it("cannot bypass the cost rule through a saved report or export", () => {
    const dataset = { title: "PO", module: "purchases.view" as const, purchaseCosts: true, headers: [], fetch: async () => [] };
    expect(canExportDataset(dataset, can("purchases.view"))).toBe(false);
    expect(canExportDataset(dataset, can("purchases.view", "accounting.view"))).toBe(true);
    expect(canExportDataset(dataset, can("accounting.view"))).toBe(false);
  });
});
