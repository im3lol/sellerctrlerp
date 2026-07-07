import { describe, it, expect } from "vitest";
import { can, canAny, isStaff, ROLE_LABELS_AR } from "../rbac";

describe("rbac.can", () => {
  it("system_admin has full ERP + admin access", () => {
    expect(can("system_admin", "employee.manage")).toBe(true);
    expect(can("system_admin", "erp.accounting.post")).toBe(true);
    expect(can("system_admin", "erp.settings.manage")).toBe(true);
  });

  it("ops_manager can operate ERP but not post/reverse GL or manage users", () => {
    expect(can("ops_manager", "erp.sales.manage")).toBe(true);
    expect(can("ops_manager", "erp.accounting.view")).toBe(true);
    expect(can("ops_manager", "erp.accounting.post")).toBe(false);
    expect(can("ops_manager", "employee.manage")).toBe(false);
  });

  it("employees have no OS capabilities (ERP access is org-scoped)", () => {
    expect(can("employee", "reports.view")).toBe(false);
    expect(can("employee", "erp.sales.view")).toBe(false);
  });

  it("null/undefined role has no capabilities", () => {
    expect(can(null, "reports.view")).toBe(false);
    expect(can(undefined, "erp.sales.view")).toBe(false);
  });
});

describe("rbac.canAny", () => {
  it("returns true if any capability is granted", () => {
    expect(canAny("ops_manager", ["employee.manage", "erp.sales.view"])).toBe(true);
    expect(canAny("employee", ["employee.manage", "reports.view"])).toBe(false);
  });
});

describe("rbac.isStaff", () => {
  it("everyone except client is staff", () => {
    expect(isStaff("system_admin")).toBe(true);
    expect(isStaff("employee")).toBe(true);
    expect(isStaff("client")).toBe(false);
    expect(isStaff(null)).toBe(false);
  });
});

describe("ROLE_LABELS_AR", () => {
  it("labels the client as partner (شريك)", () => {
    expect(ROLE_LABELS_AR.client).toBe("شريك");
  });
});
