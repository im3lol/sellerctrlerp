import { and, asc, eq } from "drizzle-orm";
import { getActiveOrg } from "@/lib/erp/org";
import { getMemberAccess } from "@/lib/erp/auth-guard";
import { getEnabledModules, ALL_MODULES } from "@/lib/erp/entitlements";
import { requireUser } from "@/lib/session";
import { db } from "@/lib/db";
import { salesPlatforms } from "@/db/schema";
import { Sidebar } from "@/components/app-shell/sidebar";
import { Topbar } from "@/components/app-shell/topbar";
import { OnboardingTour } from "@/components/app-shell/onboarding-tour";
import type { Role } from "@/lib/rbac";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const activeOrg = await getActiveOrg();

  // Modules the active tenant may see (owner sees all). Drives nav visibility;
  // page guards enforce the same entitlement server-side.
  const enabledModules = user.role === "system_admin"
    ? [...ALL_MODULES]
    : activeOrg.org ? [...(await getEnabledModules(activeOrg.org.id))] : [];

  // Nav visibility is driven by the member's ERP permissions in the active org
  // (their org role), NOT the platform OS role — so an invited team member sees
  // only the modules their role grants. Owners/system_admin have all perms → full nav.
  const access = activeOrg.org ? await getMemberAccess(activeOrg.org.id, user) : { role: null, permissions: new Set<string>() };
  const erpPermissions = [...access.permissions];

  // Live platforms listed under the "المنصات" nav group.
  const platforms = activeOrg.org
    ? await db.select({ id: salesPlatforms.id, name: salesPlatforms.name, code: salesPlatforms.code }).from(salesPlatforms)
        .where(and(eq(salesPlatforms.organizationId, activeOrg.org.id), eq(salesPlatforms.isActive, true)))
        .orderBy(asc(salesPlatforms.name))
    : [];

  return (
    <div className="flex min-h-screen bg-muted/30">
      <Sidebar role={user.role as Role} erpPermissions={erpPermissions} modules={enabledModules} platforms={platforms} />
      <div className="flex min-w-0 flex-1 flex-col overflow-x-hidden">
        <Topbar
          user={{
            name: user.name,
            email: user.email,
            role: user.role as Role,
            title: user.title,
            avatarUrl: user.avatarUrl,
          }}
          orgs={activeOrg.orgs.map((o) => ({ id: o.id, nameAr: o.nameAr }))}
          activeOrgId={activeOrg.org?.id ?? null}
          erpPermissions={erpPermissions}
          modules={enabledModules}
          platforms={platforms}
        />
        <main className="min-w-0 flex-1 p-4 md:p-6">{children}</main>
      </div>
      {user.role !== "system_admin" && <OnboardingTour />}
    </div>
  );
}
