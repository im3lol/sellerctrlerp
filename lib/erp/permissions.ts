/**
 * ERP permission model — ported from the legacy Ctrl ERP `src/lib/permissions.ts`.
 *
 * In SellerCtrl these are ORG-SCOPED: a user's ERP role lives on
 * `organization_members.role` (admin/accountant/sales/purchase/inventory/viewer),
 * and the global `system_admin` role implies all ERP permissions everywhere.
 * Enforced by `requireErpCapability` in lib/erp/auth-guard.ts.
 */

export type ErpPermission =
  // Settings
  | "settings.view" | "settings.edit"
  // Inventory
  | "inventory.view" | "inventory.create" | "inventory.edit" | "inventory.delete" | "inventory.confirm"
  // Accounting
  | "accounting.view" | "accounting.create" | "accounting.post" | "accounting.reverse"
  // Sales
  | "sales.view" | "sales.create" | "sales.edit" | "sales.confirm" | "sales.collect"
  // Purchases
  | "purchases.view" | "purchases.create" | "purchases.edit" | "purchases.confirm" | "purchases.pay"
  // Reports
  | "reports.view"
  // Investors
  | "investors.view" | "investors.create" | "investors.edit" | "investors.delete" | "investors.manage"
  // HR & Payroll
  | "hr.view" | "hr.create" | "hr.post"
  // Users (org-level membership management)
  | "users.view" | "users.create" | "users.edit" | "users.delete"
  // Organization settings
  | "organization.manage";

export const allErpPermissions: ErpPermission[] = [
  "settings.view", "settings.edit",
  "inventory.view", "inventory.create", "inventory.edit", "inventory.delete", "inventory.confirm",
  "accounting.view", "accounting.create", "accounting.post", "accounting.reverse",
  "sales.view", "sales.create", "sales.edit", "sales.confirm", "sales.collect",
  "purchases.view", "purchases.create", "purchases.edit", "purchases.confirm", "purchases.pay",
  "reports.view",
  "investors.view", "investors.create", "investors.edit", "investors.delete", "investors.manage",
  "hr.view", "hr.create", "hr.post",
  "users.view", "users.create", "users.edit", "users.delete",
  "organization.manage",
];

/** ERP membership role → permissions. Keys = `organization_members.role`. */
export const erpRolePermissions: Record<string, ErpPermission[]> = {
  admin: allErpPermissions.filter((p) => p !== "organization.manage"),

  accountant: [
    "settings.view",
    "inventory.view",
    "accounting.view", "accounting.create", "accounting.post", "accounting.reverse",
    "sales.view",
    "purchases.view",
    "reports.view",
    "investors.view", "investors.create", "investors.edit", "investors.delete", "investors.manage",
    "hr.view", "hr.create", "hr.post",
    "users.view",
  ],

  sales: [
    "settings.view",
    "inventory.view",
    "sales.view", "sales.create", "sales.edit", "sales.confirm", "sales.collect",
    "reports.view",
  ],

  purchase: [
    "settings.view",
    "inventory.view",
    "purchases.view", "purchases.create", "purchases.edit", "purchases.confirm", "purchases.pay",
    "reports.view",
  ],

  inventory: [
    "settings.view",
    "inventory.view", "inventory.create", "inventory.edit", "inventory.delete", "inventory.confirm",
    "reports.view",
  ],

  viewer: [
    "settings.view",
    "inventory.view",
    "accounting.view",
    "sales.view",
    "purchases.view",
    "reports.view",
    "investors.view",
    "users.view",
  ],
};

export const erpRoleLabels: Record<string, string> = {
  admin: "مدير",
  accountant: "محاسب",
  sales: "بائع",
  purchase: "مسؤول مشتريات",
  inventory: "أمين مخزن",
  viewer: "مشاهد",
};

export function erpRoleHasPermission(role: string, permission: ErpPermission): boolean {
  return erpRolePermissions[role]?.includes(permission) ?? false;
}

export function getErpRolePermissions(role: string): ErpPermission[] {
  return erpRolePermissions[role] ?? [];
}
