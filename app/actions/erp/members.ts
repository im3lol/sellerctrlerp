"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { organizationMembers } from "@/db/schema";
import { requireCapability } from "@/lib/session";
import { getActiveOrg } from "@/lib/erp/org";
import { allErpPermissions } from "@/lib/erp/permissions";
import type { ActionState } from "@/lib/erp/action-auth";

// A "use server" file may only export async functions — keep the role list local.
const ERP_ROLES = ["admin", "accountant", "inventory", "sales", "purchases", "viewer"];

/** Add a user to the active organization with an ERP role (or reactivate + update role). */
export async function addUserToOrgAction(userId: string, role: string): Promise<ActionState> {
  await requireCapability("employee.manage");
  const { org } = await getActiveOrg();
  if (!org) return { error: "لا توجد مؤسسة نشطة" };
  if (!ERP_ROLES.includes(role)) return { error: "دور غير صالح" };

  const [existing] = await db.select({ id: organizationMembers.id }).from(organizationMembers)
    .where(and(eq(organizationMembers.organizationId, org.id), eq(organizationMembers.userId, userId))).limit(1);
  if (existing) {
    await db.update(organizationMembers).set({ role, isActive: true }).where(eq(organizationMembers.id, existing.id));
  } else {
    await db.insert(organizationMembers).values({ organizationId: org.id, userId, role });
  }
  revalidatePath(`/admin/users/${userId}`);
  revalidatePath("/erp/hr/employees");
  return { ok: true };
}

/**
 * Set a member's per-user permission overrides on top of their role:
 * `grant` force-adds permissions, `revoke` force-removes them. Empty → cleared.
 */
export async function setMemberOverridesAction(userId: string, grant: string[], revoke: string[]): Promise<ActionState> {
  await requireCapability("employee.manage");
  const { org } = await getActiveOrg();
  if (!org) return { error: "لا توجد مؤسسة نشطة" };
  const valid = new Set<string>(allErpPermissions);
  const g = [...new Set(grant.filter((p) => valid.has(p)))];
  const r = [...new Set(revoke.filter((p) => valid.has(p)))].filter((p) => !g.includes(p)); // grant wins over revoke
  const overrides = g.length || r.length ? { grant: g, revoke: r } : null;
  await db.update(organizationMembers).set({ permissionOverrides: overrides })
    .where(and(eq(organizationMembers.organizationId, org.id), eq(organizationMembers.userId, userId)));
  revalidatePath("/erp/settings/permissions");
  revalidatePath(`/admin/users/${userId}`);
  return { ok: true };
}

/** Remove a user from the active organization. */
export async function removeUserFromOrgAction(userId: string): Promise<ActionState> {
  await requireCapability("employee.manage");
  const { org } = await getActiveOrg();
  if (!org) return { error: "لا توجد مؤسسة نشطة" };
  await db.delete(organizationMembers)
    .where(and(eq(organizationMembers.organizationId, org.id), eq(organizationMembers.userId, userId)));
  revalidatePath(`/admin/users/${userId}`);
  revalidatePath("/erp/hr/employees");
  return { ok: true };
}
