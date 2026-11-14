import { describe, it, expect } from "vitest";
import { entitledPermissions, moduleOfPermission } from "../permission-modules";
describe("permission and subscription intersection", () => {
  const permissions = new Set(["inventory.view", "accounting.view", "sales.view", "sales.create", "users.edit"]);
  it("keeps core controls available and removes unpaid data permissions", () => {
    expect(entitledPermissions(permissions, new Set(["inventory"]), "inventory.view")).toEqual(new Set(["inventory.view", "users.edit"]));
    expect(moduleOfPermission("approvals.decide")).toBe("settings");
  });
  it("allows platform RBAC within its explicit module without enabling other financial data", () => {
    const actual = entitledPermissions(permissions, new Set(["marketplace"]), "sales.create", "marketplace");
    expect(actual.has("sales.create")).toBe(true);
    expect(actual.has("accounting.view")).toBe(false);
  });
  it("does not use a disabled override to grant permissions", () => {
    expect(entitledPermissions(permissions, new Set(), "sales.create", "marketplace").has("sales.create")).toBe(false);
  });
  it("never adds permissions absent from the member's effective set", () => {
    expect(entitledPermissions(new Set(), new Set(["accounting"]), "accounting.view").size).toBe(0);
  });
});
