import { describe, it, expect } from "vitest";
import { erpRoleHasPermission } from "../permissions";

describe("erpRoleHasPermission", () => {
  it("accountant can post GL but not create sales", () => {
    expect(erpRoleHasPermission("accountant", "accounting.post")).toBe(true);
    expect(erpRoleHasPermission("accountant", "sales.create")).toBe(false);
  });
  it("sales can confirm/collect sales but not post GL", () => {
    expect(erpRoleHasPermission("sales", "sales.confirm")).toBe(true);
    expect(erpRoleHasPermission("sales", "sales.collect")).toBe(true);
    expect(erpRoleHasPermission("sales", "accounting.post")).toBe(false);
  });
  it("viewer can only view", () => {
    expect(erpRoleHasPermission("viewer", "sales.view")).toBe(true);
    expect(erpRoleHasPermission("viewer", "sales.create")).toBe(false);
    expect(erpRoleHasPermission("viewer", "accounting.post")).toBe(false);
  });
  it("admin has broad access but not the org-owner action", () => {
    expect(erpRoleHasPermission("admin", "accounting.post")).toBe(true);
    expect(erpRoleHasPermission("admin", "organization.manage")).toBe(false);
  });
  it("unknown roles have no permissions", () => {
    expect(erpRoleHasPermission("nope", "sales.view")).toBe(false);
  });

  /**
   * Separation of duties on the purchase cycle: stores book and confirm the goods
   * receipt; purchasing bills it and loads the import costs. `purchases.receive` is
   * what keeps those two apart — before it existed, stores could not receive at all
   * and purchasing did everything.
   */
  describe("goods receipt vs. the money side", () => {
    it("stores can receive, and can do nothing else in purchasing", () => {
      expect(erpRoleHasPermission("inventory", "purchases.receive")).toBe(true);
      expect(erpRoleHasPermission("inventory", "purchases.view")).toBe(true);
      // No billing, no cancelling a posted receipt, no import costs, no paying.
      expect(erpRoleHasPermission("inventory", "purchases.create")).toBe(false);
      expect(erpRoleHasPermission("inventory", "purchases.confirm")).toBe(false);
      expect(erpRoleHasPermission("inventory", "purchases.pay")).toBe(false);
      expect(erpRoleHasPermission("inventory", "accounting.view")).toBe(false);
    });

    it("purchasing can both receive and carry the money side", () => {
      expect(erpRoleHasPermission("purchase", "purchases.receive")).toBe(true);
      expect(erpRoleHasPermission("purchase", "purchases.create")).toBe(true);
      expect(erpRoleHasPermission("purchase", "purchases.confirm")).toBe(true);
    });

    it("accounting sees purchases but never receives stock", () => {
      expect(erpRoleHasPermission("accountant", "purchases.view")).toBe(true);
      expect(erpRoleHasPermission("accountant", "purchases.receive")).toBe(false);
    });

    it("stores cannot see costs on a receipt (purchases.create OR accounting.view)", () => {
      const canSeeCost = (role: string) =>
        erpRoleHasPermission(role, "purchases.create") || erpRoleHasPermission(role, "accounting.view");
      expect(canSeeCost("inventory")).toBe(false);
      expect(canSeeCost("purchase")).toBe(true);
      expect(canSeeCost("accountant")).toBe(true);
      expect(canSeeCost("admin")).toBe(true);
    });
  });
});
