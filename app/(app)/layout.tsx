import { getActiveOrg } from "@/lib/erp/org";
import { getEnabledModules, ALL_MODULES } from "@/lib/erp/entitlements";
import { requireUser } from "@/lib/session";
import { Sidebar } from "@/components/app-shell/sidebar";
import { Topbar } from "@/components/app-shell/topbar";
import type { Role } from "@/lib/rbac";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const activeOrg = await getActiveOrg();

  // Modules the active tenant may see (owner sees all). Drives nav visibility;
  // page guards enforce the same entitlement server-side.
  const enabledModules = user.role === "system_admin"
    ? [...ALL_MODULES]
    : activeOrg.org ? [...(await getEnabledModules(activeOrg.org.id))] : [];

  return (
    <div className="flex min-h-screen bg-muted/30">
      <Sidebar role={user.role as Role} modules={enabledModules} />
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
          modules={enabledModules}
        />
        <main className="min-w-0 flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
