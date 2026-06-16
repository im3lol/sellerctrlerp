/**
 * Role-based access control (spec §2).
 * Capability matrix per role. Server actions and middleware both consult this.
 */

export type Role = "system_admin" | "ops_manager" | "team_lead" | "employee" | "client";

export type Capability =
  | "workspace.create"
  | "workspace.manage"
  | "workspace.viewAll"
  | "client.manage"
  | "employee.manage"
  | "role.manage"
  | "reports.view"
  | "sheets.connect"
  | "product.distribute"
  | "product.review"
  | "product.edit"
  | "task.manage"
  | "task.approve"
  | "task.updateOwn"
  | "attendance.self"
  | "attendance.viewAll"
  | "ai.use"
  | "client.portal";

const MATRIX: Record<Role, Capability[]> = {
  // مدير النظام — full access
  system_admin: [
    "workspace.create", "workspace.manage", "workspace.viewAll",
    "client.manage", "employee.manage", "role.manage", "reports.view",
    "sheets.connect", "product.distribute", "product.review", "product.edit",
    "task.manage", "task.approve", "task.updateOwn",
    "attendance.self", "attendance.viewAll", "ai.use",
  ],
  // مدير العمليات
  ops_manager: [
    "workspace.viewAll", "reports.view", "product.distribute", "product.review",
    "product.edit", "task.manage", "task.approve", "task.updateOwn",
    "attendance.self", "attendance.viewAll", "ai.use", "sheets.connect",
  ],
  // قائد فريق
  team_lead: [
    "product.review", "product.edit", "task.manage", "task.approve",
    "task.updateOwn", "attendance.self", "reports.view",
  ],
  // موظف
  employee: [
    "product.edit", "task.updateOwn", "attendance.self",
  ],
  // عميل (Seller)
  client: [
    "client.portal",
  ],
};

export function can(role: Role | undefined | null, capability: Capability): boolean {
  if (!role) return false;
  return MATRIX[role]?.includes(capability) ?? false;
}

export function canAny(role: Role | undefined | null, caps: Capability[]): boolean {
  return caps.some((c) => can(role, c));
}

export const ROLE_LABELS_AR: Record<Role, string> = {
  system_admin: "مدير النظام",
  ops_manager: "مدير العمليات",
  team_lead: "قائد فريق",
  employee: "موظف",
  client: "شريك",
};

/** Roles considered internal staff (everyone except clients). */
export function isStaff(role: Role | undefined | null): boolean {
  return !!role && role !== "client";
}
