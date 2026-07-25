import { requireUser } from "@/lib/session";
import { getActiveOrg } from "@/lib/erp/org";
import { getMemberAccess } from "@/lib/erp/auth-guard";
import { SETTINGS_GROUPS } from "@/lib/erp/settings-nav";
import { SettingsNav } from "@/components/erp/settings-nav";

/**
 * The settings shell: a persistent grouped side nav so every settings page is one
 * click from any other. Items are filtered by the member's ERP permissions (same
 * source as the main sidebar); each page still enforces its own guard server-side.
 */
export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const activeOrg = await getActiveOrg();
  const access = activeOrg.org
    ? await getMemberAccess(activeOrg.org.id, user)
    : { role: null, permissions: new Set<string>() };

  const groups = SETTINGS_GROUPS
    .map((g) => ({ ...g, items: g.items.filter((it) => !it.capability || access.permissions.has(it.capability)) }))
    .filter((g) => g.items.length > 0);

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
      <SettingsNav groups={groups} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
