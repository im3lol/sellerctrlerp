import { cache } from "react";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { orgSubscriptions } from "@/db/schema";
import { ALL_MODULES, MODULE_LABELS } from "@/lib/erp/module-list";

// Re-export so existing imports from this file keep working.
export { ALL_MODULES, MODULE_LABELS };
export type { ModuleKey } from "@/lib/erp/module-list";

/** Map an ERP permission (e.g. "sales.view", "accounting.post") to its module. */
export function moduleOfPermission(permission: string): string {
  return permission.split(".")[0];
}

/**
 * Modules the org may access. No subscription row → ALL enabled (existing tenants
 * are grandfathered). A live subscription (ACTIVE/TRIAL, not past expiry) → its
 * `enabledModules`. Expired/cancelled → nothing.
 */
// cache() deduplicates repeated calls within the same request (React Server
// Components may call requireErpModule + orgHasModule for the same org).
export const getEnabledModules = cache(async (orgId: string): Promise<Set<string>> => {
  const [sub] = await db.select().from(orgSubscriptions).where(eq(orgSubscriptions.organizationId, orgId)).limit(1);
  if (!sub) return new Set(ALL_MODULES);
  const live = (sub.status === "ACTIVE" || sub.status === "TRIAL") && (!sub.expiresAt || new Date(sub.expiresAt) > new Date());
  if (!live) return new Set();
  return new Set(sub.enabledModules ?? []);
});

/** Whether the org's subscription includes a module (`settings` is always core). */
export async function orgHasModule(orgId: string, moduleKey: string): Promise<boolean> {
  if (moduleKey === "settings") return true;
  return (await getEnabledModules(orgId)).has(moduleKey);
}
