import { ALL_MODULES, MODULE_LABELS } from "@/lib/erp/module-list";
import { getSubscriptionState } from "@/lib/erp/subscription";

// Re-export so existing imports from this file keep working.
export { ALL_MODULES, MODULE_LABELS };
export type { ModuleKey } from "@/lib/erp/module-list";

/** Map an ERP permission (e.g. "sales.view", "accounting.post") to its module. */
export function moduleOfPermission(permission: string): string {
  return permission.split(".")[0];
}

/**
 * Modules the org may access — delegates to the subscription engine. No row →
 * 14-day trial from creation (all modules) then locked; a live subscription →
 * its `enabledModules`; expired/cancelled → nothing. See {@link getSubscriptionState}.
 */
export async function getEnabledModules(orgId: string): Promise<Set<string>> {
  return new Set((await getSubscriptionState(orgId)).modules);
}

/** Whether the org's subscription includes a module (`settings` is always core). */
export async function orgHasModule(orgId: string, moduleKey: string): Promise<boolean> {
  if (moduleKey === "settings") return true;
  return (await getEnabledModules(orgId)).has(moduleKey);
}
