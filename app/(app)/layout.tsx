import { redirect } from "next/navigation";
import { and, eq, isNull, sql } from "drizzle-orm";
import { requireUser } from "@/lib/session";
import { db } from "@/lib/db";
import { notifications } from "@/db/schema";
import { getTodaySnapshot } from "@/lib/attendance";
import { getActiveOrg } from "@/lib/erp/org";
import { getEnabledModules, ALL_MODULES } from "@/lib/erp/entitlements";
import { isOnPremMode, getLicenseStatus } from "@/lib/erp/remote-license";
import { Sidebar } from "@/components/app-shell/sidebar";
import { Topbar } from "@/components/app-shell/topbar";
import { PollRefresh } from "@/components/realtime/poll-refresh";
import { LicenseLocked, LicenseGraceBanner } from "@/components/erp/license-locked";
import type { Role } from "@/lib/rbac";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  if (user.role === "client") redirect("/portal");

  // On-prem deployments: enforce license check before rendering any ERP page.
  let graceDays: number | undefined;
  if (isOnPremMode()) {
    const lic = await getLicenseStatus();
    if (lic.status === "LOCKED") return <LicenseLocked />;
    if (lic.status === "GRACE") graceDays = lic.daysLeft;
  }

  const [[{ count }], attendanceSnap, activeOrg] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(eq(notifications.userId, user.id), isNull(notifications.readAt))),
    getTodaySnapshot(user.id),
    getActiveOrg(),
  ]);

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
          unreadCount={count ?? 0}
          attendance={attendanceSnap}
          orgs={activeOrg.orgs.map((o) => ({ id: o.id, nameAr: o.nameAr }))}
          activeOrgId={activeOrg.org?.id ?? null}
          modules={enabledModules}
        />
        {graceDays != null && <LicenseGraceBanner daysLeft={graceDays} />}
        <main className="min-w-0 flex-1 p-4 md:p-6">{children}</main>
        <PollRefresh />
      </div>
    </div>
  );
}
