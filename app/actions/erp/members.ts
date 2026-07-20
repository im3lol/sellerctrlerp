"use server";

import { withOrgScope } from "@/lib/db-scope";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { organizationMembers, users } from "@/db/schema";
import { requireCapability } from "@/lib/session";
import { getActiveOrg } from "@/lib/erp/org";
import { authorizeErp } from "@/lib/erp/action-auth";
import { allErpPermissions, erpRoleLabels } from "@/lib/erp/permissions";
import { seatLimitError } from "@/lib/erp/plans";
import { tryRecordAudit } from "@/lib/erp/audit";
import { validatePassword, BCRYPT_COST } from "@/lib/auth/password-policy";
import type { ActionState } from "@/lib/erp/action-auth";

// A "use server" file may only export async functions — keep the role list local.
// These are the assignable ERP org roles (must match erpRoleLabels keys).
const ERP_ROLES = ["admin", "accountant", "inventory", "sales", "purchase", "viewer"];

/**
 * Invite a NEW team member to the CURRENT org (org-admin self-service). Creates
 * the user with an initial password and adds them to this org with an ERP role —
 * scoped to the caller's org only (no cross-tenant linking). Their sidebar/access
 * follow the chosen role. Guarded by the org-level `users.create` permission.
 */
export async function inviteMemberAction(input: { name: string; email: string; role: string; password: string }): Promise<ActionState> {
  const auth = await authorizeErp("users.create");
  if ("error" in auth) return auth;
  return withOrgScope(auth.orgId, false, async () => {
    const { orgId, userId: actorId } = auth;

    const name = (input.name ?? "").trim();
    const email = (input.email ?? "").trim().toLowerCase();
    const role = input.role;
    const password = input.password ?? "";
    if (name.length < 2) return { error: "الاسم مطلوب" };
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "بريد إلكتروني غير صالح" };
    if (!ERP_ROLES.includes(role)) return { error: "دور غير صالح" };
    const pwErr = validatePassword(password);
    if (pwErr) return { error: pwErr };

    const capError = await seatLimitError(orgId);
    if (capError) return { error: capError };

    // Only create brand-new users here — never silently attach an existing account
    // (which could belong to another tenant).
    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (existing) return { error: "هذا البريد مستخدم بالفعل — استخدم بريدًا آخر" };

    try {
      const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
      const newUserId = await db.transaction(async (tx) => {
        const [u] = await tx.insert(users).values({ name, email, passwordHash, passwordChangedAt: new Date(), role: "employee", title: erpRoleLabels[role] ?? role }).returning({ id: users.id });
        await tx.insert(organizationMembers).values({ organizationId: orgId, userId: u.id, role });
        return u.id;
      });
      await tryRecordAudit({ orgId, userId: actorId, action: "CREATE", entityType: "MEMBER", entityId: newUserId, entityNumber: email, summary: `دعوة عضو ${name} (${erpRoleLabels[role] ?? role})` });
      revalidatePath("/settings/permissions");
      return { ok: true };
    } catch {
      return { error: "تعذّر إنشاء العضو" };
    }
  });
}

/** Add a user to the active organization with an ERP role (or reactivate + update role). */
export async function addUserToOrgAction(userId: string, role: string): Promise<ActionState> {
  await requireCapability("employee.manage");
  const { org } = await getActiveOrg();
  if (!org) return { error: "لا توجد مؤسسة نشطة" };
  if (!ERP_ROLES.includes(role)) return { error: "دور غير صالح" };

  const [existing] = await db.select({ id: organizationMembers.id, isActive: organizationMembers.isActive }).from(organizationMembers)
    .where(and(eq(organizationMembers.organizationId, org.id), eq(organizationMembers.userId, userId))).limit(1);
  // Enforce the plan seat cap only when this op adds an active seat (new member or reactivation).
  if (!existing || !existing.isActive) {
    const capError = await seatLimitError(org.id);
    if (capError) return { error: capError };
  }
  if (existing) {
    await db.update(organizationMembers).set({ role, isActive: true }).where(eq(organizationMembers.id, existing.id));
  } else {
    await db.insert(organizationMembers).values({ organizationId: org.id, userId, role });
  }
  revalidatePath(`/admin/users/${userId}`);
  revalidatePath("/hr/employees");
  return { ok: true };
}

/**
 * Set a member's per-user permission overrides on top of their role:
 * `grant` force-adds permissions, `revoke` force-removes them. Empty → cleared.
 */
export async function setMemberOverridesAction(userId: string, grant: string[], revoke: string[]): Promise<ActionState> {
  const auth = await authorizeErp("users.edit");
  if ("error" in auth) return auth;
  // No self-override: users.edit lets you manage OTHERS, not grant yourself new
  // permissions — that's privilege escalation. system_admin already has everything.
  if (userId === auth.userId) return { error: "لا يمكنك تعديل صلاحيات نفسك" };
  return withOrgScope(auth.orgId, false, async () => {
    const org = { id: auth.orgId };
    const valid = new Set<string>(allErpPermissions);
    const g = [...new Set(grant.filter((p) => valid.has(p)))];
    const r = [...new Set(revoke.filter((p) => valid.has(p)))].filter((p) => !g.includes(p)); // grant wins over revoke
    const overrides = g.length || r.length ? { grant: g, revoke: r } : null;
    await db.update(organizationMembers).set({ permissionOverrides: overrides })
      .where(and(eq(organizationMembers.organizationId, org.id), eq(organizationMembers.userId, userId)));
    revalidatePath("/settings/permissions");
    revalidatePath(`/admin/users/${userId}`);
    return { ok: true };
  });
}

/** Remove a user from the active organization. */
export async function removeUserFromOrgAction(userId: string): Promise<ActionState> {
  const auth = await authorizeErp("users.delete");
  if ("error" in auth) return auth;
  return withOrgScope(auth.orgId, false, async () => {
    const org = { id: auth.orgId };
    await db.delete(organizationMembers)
      .where(and(eq(organizationMembers.organizationId, org.id), eq(organizationMembers.userId, userId)));
    revalidatePath(`/admin/users/${userId}`);
    revalidatePath("/hr/employees");
    return { ok: true };
  });
}
