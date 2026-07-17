import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { organizations, organizationMembers } from "@/db/schema";
import { getCurrentUser, type SessionUser } from "@/lib/session";
import { getMemberAccess } from "@/lib/erp/auth-guard";
import { erpRoleHasPermission, type ErpPermission } from "@/lib/erp/permissions";
import { orgHasModule, moduleOfPermission } from "@/lib/erp/entitlements";
import { withOrgScope, withPlatformScope } from "@/lib/db-scope";

export const ACTIVE_ORG_COOKIE = "erp_org";

export type OrgSummary = { id: string; nameAr: string; nameEn: string };

/** Organizations the user may access: all (system_admin) or active memberships.
 *  Cached per request — resolved on every ERP page via requireErpModule. */
export const getUserOrganizations = cache(async (user: SessionUser): Promise<OrgSummary[]> => {
  // Auth bootstrap: lists the user's orgs BEFORE any tenant scope exists, and
  // reads the RLS-policied organization_members across all of them — so it must
  // run in platform scope. The userId filter (or system_admin) is the control.
  return withPlatformScope(async () => {
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
  });
});

/** Resolve the active organization from the cookie (falling back to the first).
 *  Cached per request — called by the layout + every page's requireErpModule. */
export const getActiveOrg = cache(async (): Promise<{
  user: SessionUser | null;
  org: OrgSummary | null;
  orgs: OrgSummary[];
}> => {
  const user = await getCurrentUser();
  if (!user) return { user: null, org: null, orgs: [] };
  const orgs = await getUserOrganizations(user);
  const cid = (await cookies()).get(ACTIVE_ORG_COOKIE)?.value;
  const org = orgs.find((o) => o.id === cid) ?? orgs[0] ?? null;
  return { user, org, orgs };
});

/**
 * Page-level guard for ERP modules: resolves the active org and enforces an ERP
 * permission within it, redirecting (not throwing) like the OS `requireCapability`.
 */
export async function requireErpModule(
  permission: ErpPermission,
  moduleOverride?: string,
): Promise<{ orgId: string; role: string; can: (p: ErpPermission) => boolean }> {
  const { user, org } = await getActiveOrg();
  if (!user) redirect("/login");
  if (!org) redirect("/dashboard");
  const access = await getMemberAccess(org.id, user);
  if (!access.role) redirect("/dashboard");
  if (!access.permissions.has(permission)) redirect("/dashboard");
  // Subscription entitlement: the tenant must have the module enabled. The
  // platform owner (system_admin) bypasses so they can support any account.
  // `moduleOverride` gates on a different module than the permission's own
  // (e.g. platforms pages use sales.* RBAC but gate on the "marketplace" plan).
  if (user.role !== "system_admin") {
    const mod = moduleOverride ?? moduleOfPermission(permission);
    // Locked (trial lapsed / no active plan) or module not in the plan → send to
    // the in-app subscription page to pick a plan.
    if (mod !== "settings" && !(await orgHasModule(org.id, mod))) redirect(`/erp/settings/subscription?locked=${mod}`);
  }
  return { orgId: org.id, role: access.role, can: (p: ErpPermission) => access.permissions.has(p) };
}

/**
 * Load an ERP page inside the tenant DB scope: guard the module, then run the page's
 * data-loading + render with every query RLS-isolated to the active org.
 *
 *   export default (props) => loadErpPage("sales.view", async ({ orgId, can }) => {
 *     const rows = await db.select()...;   // scoped
 *     return <SalesInvoices rows={rows} canManage={can("sales.create")} />;
 *   });
 *
 * isAdmin is false: a system_admin viewing the tenant workspace picked one org via the
 * cookie, so cross-org stays reserved for /admin (withPlatformScope).
 */
export async function loadErpPage<T>(
  permission: ErpPermission,
  handler: (ctx: { orgId: string; role: string; can: (p: ErpPermission) => boolean }) => Promise<T>,
  moduleOverride?: string,
): Promise<T> {
  const ctx = await requireErpModule(permission, moduleOverride);
  return withOrgScope(ctx.orgId, false, () => handler(ctx));
}

/** Whether an ERP role may perform an action (super_admin bypasses). */
export function erpCan(role: string, permission: ErpPermission): boolean {
  return role === "super_admin" || erpRoleHasPermission(role, permission);
}
