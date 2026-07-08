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
});
