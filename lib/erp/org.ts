import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { organizations, organizationMembers } from "@/db/schema";
import { getCurrentUser, type SessionUser } from "@/lib/session";
import { getErpRole } from "@/lib/erp/auth-guard";
import { erpRoleHasPermission, type ErpPermission } from "@/lib/erp/permissions";

export const ACTIVE_ORG_COOKIE = "erp_org";

export type OrgSummary = { id: string; nameAr: string; nameEn: string };

/** Organizations the user may access: all (system_admin) or active memberships. */
export async function getUserOrganizations(user: SessionUser): Promise<OrgSummary[]> {
  if (user.role === "system_admin") {
    return db
      .select({ id: organizations.id, nameAr: organizations.nameAr, nameEn: organizations.nameEn })
      .from(organizations)
      .orderBy(asc(organizations.createdAt));
  }
  return db
    .select({ id: organizations.id, nameAr: organizations.nameAr, nameEn: organizations.nameEn })
    .from(organizationMembers)
    .innerJoin(organizations, eq(organizationMembers.organizationId, organizations.id))
    .where(and(eq(organizationMembers.userId, user.id), eq(organizationMembers.isActive, true)))
    .orderBy(asc(organizations.createdAt));
}

/** Resolve the active organization from the cookie (falling back to the first). */
export async function getActiveOrg(): Promise<{
  user: SessionUser | null;
  org: OrgSummary | null;
  orgs: OrgSummary[];
}> {
  const user = await getCurrentUser();
  if (!user) return { user: null, org: null, orgs: [] };
  const orgs = await getUserOrganizations(user);
  const cid = (await cookies()).get(ACTIVE_ORG_COOKIE)?.value;
  const org = orgs.find((o) => o.id === cid) ?? orgs[0] ?? null;
  return { user, org, orgs };
}

/**
 * Page-level guard for ERP modules: resolves the active org and enforces an ERP
 * permission within it, redirecting (not throwing) like the OS `requireCapability`.
 */
export async function requireErpModule(
  permission: ErpPermission,
): Promise<{ orgId: string; role: string }> {
  const { user, org } = await getActiveOrg();
  if (!user) redirect("/login");
  if (!org) redirect("/dashboard");
  const role = await getErpRole(org.id, user);
  if (!role) redirect("/dashboard");
  if (role !== "super_admin" && !erpRoleHasPermission(role, permission)) redirect("/dashboard");
  return { orgId: org.id, role };
}

/** Whether an ERP role may perform an action (super_admin bypasses). */
export function erpCan(role: string, permission: ErpPermission): boolean {
  return role === "super_admin" || erpRoleHasPermission(role, permission);
}
