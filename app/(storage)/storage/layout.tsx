import { redirect } from "next/navigation";
import { getActiveOrg } from "@/lib/erp/org";
import { getT } from "@/lib/i18n/server";
import { StorageShell } from "@/components/erp/storage-shell";
import { OrgSwitcher } from "@/components/app-shell/org-switcher";
import { signOutAction } from "@/app/actions/auth";
import { getMemberAccess } from "@/lib/erp/auth-guard";
export const dynamic = "force-dynamic";
export default async function StorageLayout({ children }: { children: React.ReactNode }) {
  const { user, org, orgs } = await getActiveOrg();
  if (!user) redirect("/login?callbackUrl=%2Fstorage");
  const t = await getT();
  const manageCloud = org ? (await getMemberAccess(org.id, user)).permissions.has("settings.edit") : false;
  return <StorageShell admin={user.role === "system_admin"} manageCloud={manageCloud} appUrl={new URL("/dashboard", process.env.APP_URL ?? "https://app.sellerctrl.com").href} account={<>
    <OrgSwitcher orgs={orgs.map(o => ({ id: o.id, nameAr: o.nameAr }))} activeId={org?.id ?? null} />
    <span className="hidden max-w-40 truncate text-sm sm:block">{user.name}</span>
    <form action={signOutAction}><button className="min-h-10 rounded-lg px-2 text-xs text-muted-foreground hover:bg-muted">{t("تسجيل الخروج")}</button></form>
  </>}>{children}</StorageShell>;
}
