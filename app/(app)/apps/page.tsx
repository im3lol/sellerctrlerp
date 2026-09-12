import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { organizations } from "@/db/schema";
import { getActiveOrg } from "@/lib/erp/org";
import { getEnabledModules, ALL_MODULES } from "@/lib/erp/entitlements";
import { getMemberAccess } from "@/lib/erp/auth-guard";
import { ErpPageHeader } from "@/components/erp/page-header";
import { AppLauncher } from "@/components/app-shell/app-launcher";

/**
 * The home screen: every module as a tile.
 *
 * Same page the topbar's grid button opens in a dialog — this is the addressable,
 * bookmarkable version of it, and where the logo goes.
 */
export default async function AppsPage() {
  const { user, org } = await getActiveOrg();
  const modules = user?.role === "system_admin" ? [...ALL_MODULES] : org ? [...(await getEnabledModules(org.id))] : [];
  const access = org && user ? await getMemberAccess(org.id, user) : { permissions: new Set<string>() };
  const navHidden = org
    ? await db.select({ hidden: organizations.navHidden }).from(organizations)
        .where(eq(organizations.id, org.id)).limit(1).then((r) => r[0]?.hidden ?? [])
    : [];

  return (
    <div className="space-y-6">
      <ErpPageHeader icon="LayoutGrid" title="التطبيقات" subtitle="كل موديول في السيستم — ابدأ من هنا" />
      <AppLauncher erpPermissions={[...access.permissions]} modules={modules} navHidden={navHidden} />
    </div>
  );
}
