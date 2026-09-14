import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { organizations } from "@/db/schema";
import { getActiveOrg } from "@/lib/erp/org";
import { getEnabledModules, ALL_MODULES } from "@/lib/erp/entitlements";
import { getMemberAccess } from "@/lib/erp/auth-guard";
import { getSubscriptionState } from "@/lib/erp/subscription";
import { ErpPageHeader } from "@/components/erp/page-header";
import { AppLauncher } from "@/components/app-shell/app-launcher";
import { SubscriptionBanner } from "@/components/erp/subscription-banner";

/**
 * The home screen: every module as a tile. Where everyone lands — after signing in, on
 * the bare domain, and when a page they may not open sends them back.
 *
 * Same page the topbar's grid button opens in a dialog — this is the addressable,
 * bookmarkable version of it, and where the logo goes. Modules only: the one thing
 * besides them is a warning when the subscription is about to lock the system.
 */
export default async function AppsPage() {
  const { user, org } = await getActiveOrg();
  const modules = user?.role === "system_admin" ? [...ALL_MODULES] : org ? [...(await getEnabledModules(org.id))] : [];
  const access = org && user ? await getMemberAccess(org.id, user) : { permissions: new Set<string>() };
  const navHidden = org
    ? await db.select({ hidden: organizations.navHidden }).from(organizations)
        .where(eq(organizations.id, org.id)).limit(1).then((r) => r[0]?.hidden ?? [])
    : [];
  const sub = org && user?.role !== "system_admin" ? await getSubscriptionState(org.id) : null;

  return (
    <div className="space-y-6">
      <ErpPageHeader icon="LayoutGrid" title="التطبيقات" subtitle="كل موديول في السيستم — ابدأ من هنا" />
      <SubscriptionBanner sub={sub} />
      <AppLauncher erpPermissions={[...access.permissions]} modules={modules} navHidden={navHidden} />
    </div>
  );
}
