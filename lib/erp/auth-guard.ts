/**
 * Org-scoped ERP authorization. Replaces the legacy Ctrl ERP `requirePermission`
 * (which resolved a companyId) with the unified SellerCtrl model:
 *
 *   - Identity comes from the Auth.js session (`getCurrentUser`).
 *   - A global `system_admin` implies all ERP permissions in every org.
 *   - Otherwise the user's ERP role is their `organization_members.role` for the
 *     target org, mapped through `erpRolePermissions`.
 *
 * Every ported ERP route calls `requireErpCapability(orgId, "<permission>")`
 * with the same permission string the legacy `requirePermission` used.
 */
import { cache } from "react";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { organizationMembers } from "@/db/schema";
import { getCurrentUser, type SessionUser } from "@/lib/session";
import { erpRoleHasPermission, erpRolePermissions, allErpPermissions, type ErpPermission } from "@/lib/erp/permissions";

export class ErpAuthError extends Error {
  status: number;
  constructor(message: string, status = 403) {
    super(message);
    this.name = "ErpAuthError";
    this.status = status;
  }
}

export interface ErpAuthUser extends SessionUser {
  organizationId: string;
  /** Membership role in the org, or "super_admin" for a global system_admin. */
  erpRole: string;
}

/** The caller's effective ERP role in an org, or null if not a member.
 *  Cached per request — hit by requireErpModule + erpCan on every page/action. */
export const getErpRole = cache(async (orgId: string, user: SessionUser): Promise<string | null> => {
  if (user.role === "system_admin") return "super_admin";
  const [m] = await db
    .select({ role: organizationMembers.role, isActive: organizationMembers.isActive })
    .from(organizationMembers)
    .where(and(eq(organizationMembers.organizationId, orgId), eq(organizationMembers.userId, user.id)))
    .limit(1);
  if (!m || !m.isActive) return null;
  return m.role;
});

export type MemberAccess = { role: string | null; permissions: Set<string> };

/**
 * The caller's EFFECTIVE ERP permissions in an org = role permissions, plus any
 * per-user `grant` overrides, minus any `revoke` overrides. A global system_admin
 * gets everything. Cached per request. This is the single source of truth for
 * both page guards and action authorization.
 */
export const getMemberAccess = cache(async (orgId: string, user: SessionUser): Promise<MemberAccess> => {
  if (user.role === "system_admin") return { role: "super_admin", permissions: new Set(allErpPermissions) };
  const [m] = await db
    .select({ role: organizationMembers.role, isActive: organizationMembers.isActive, overrides: organizationMembers.permissionOverrides })
    .from(organizationMembers)
    .where(and(eq(organizationMembers.organizationId, orgId), eq(organizationMembers.userId, user.id)))
    .limit(1);
  if (!m || !m.isActive) return { role: null, permissions: new Set() };
  const perms = new Set<string>(erpRolePermissions[m.role] ?? []);
  const ov = m.overrides ?? null;
  for (const p of ov?.grant ?? []) perms.add(p);
  for (const p of ov?.revoke ?? []) perms.delete(p);
  return { role: m.role, permissions: perms };
});

/** Require an authenticated user who belongs to the given org. */
export async function requireErpAuth(orgId: string): Promise<ErpAuthUser> {
  const user = await getCurrentUser();
  if (!user) throw new ErpAuthError("غير مصرح بالدخول", 401);
  if (!orgId) throw new ErpAuthError("لم يتم تحديد المؤسسة", 400);
  const erpRole = await getErpRole(orgId, user);
  if (!erpRole) throw new ErpAuthError("غير مصرح بالوصول إلى هذه المؤسسة", 403);
  return { ...user, organizationId: orgId, erpRole };
}

/** Require a specific ERP permission within an org. */
export async function requireErpCapability(orgId: string, permission: ErpPermission): Promise<ErpAuthUser> {
  const u = await requireErpAuth(orgId);
  if (u.erpRole === "super_admin") return u; // global system_admin bypass
  if (!erpRoleHasPermission(u.erpRole, permission)) {
    throw new ErpAuthError("ليس لديك صلاحية لهذا الإجراء", 403);
  }
  return u;
}
