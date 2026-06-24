import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { getActiveOrg, type OrgSummary } from "@/lib/erp/org";
import { orgHasModule } from "@/lib/erp/entitlements";
import { can, type Capability, type Role } from "@/lib/rbac";
import type { SessionUser } from "@/lib/session";

export type CrmContext = { user: SessionUser; role: Role; orgId: string; org: OrgSummary };

/**
 * Org-scoped guard for CRM pages. CRM is now a normal module of the system, so —
 * exactly like `requireErpModule` — it resolves the active organization (from the
 * `erp_org` cookie) and only then lets the page query CRM data, which is filtered
 * by that org. An optional OS-role capability is also enforced. Redirects (never
 * throws) so it composes like the rest of the app's page guards.
 */
export async function requireCrm(capability?: Capability): Promise<CrmContext> {
  const user = await requireUser();
  const { org } = await getActiveOrg();
  if (!org) redirect("/dashboard");
  if (capability && !can(user.role as Role, capability)) redirect("/dashboard");
  // CRM module entitlement (platform owner bypasses).
  if (user.role !== "system_admin" && !(await orgHasModule(org.id, "crm"))) redirect("/dashboard?locked=crm");
  return { user, role: user.role as Role, orgId: org.id, org };
}

/**
 * Non-redirecting variant for surfaces (like the home dashboard) that must render
 * for users without an active org too. Returns the active org id or null.
 */
export async function activeOrgId(): Promise<string | null> {
  const { org } = await getActiveOrg();
  return org?.id ?? null;
}
