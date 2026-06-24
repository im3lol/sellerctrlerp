import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { orgSubscriptions } from "@/db/schema";

/** ERP/CRM modules a subscription can grant. `settings` is platform-core and
 *  never gated. Keys match the nav-section moduleKey + the ErpPermission prefix. */
export const ALL_MODULES = ["accounting", "inventory", "sales", "purchases", "crm", "investors", "reports", "hr"] as const;
export type ModuleKey = (typeof ALL_MODULES)[number];

export const MODULE_LABELS: Record<string, string> = {
  accounting: "المحاسبة",
  inventory: "المخزون",
  sales: "المبيعات",
  purchases: "المشتريات",
  crm: "إدارة العملاء (CRM)",
  investors: "المستثمرون",
  reports: "التقارير",
  hr: "الموارد البشرية",
};

/** Map an ERP permission (e.g. "sales.view", "accounting.post") to its module. */
export function moduleOfPermission(permission: string): string {
  return permission.split(".")[0];
}

/**
 * Modules the org may access. No subscription row → ALL enabled (existing tenants
 * are grandfathered). A live subscription (ACTIVE/TRIAL, not past expiry) → its
 * `enabledModules`. Expired/cancelled → nothing.
 */
export async function getEnabledModules(orgId: string): Promise<Set<string>> {
  const [sub] = await db.select().from(orgSubscriptions).where(eq(orgSubscriptions.organizationId, orgId)).limit(1);
  if (!sub) return new Set(ALL_MODULES);
  const live = (sub.status === "ACTIVE" || sub.status === "TRIAL") && (!sub.expiresAt || new Date(sub.expiresAt) > new Date());
  if (!live) return new Set();
  return new Set(sub.enabledModules ?? []);
}

/** Whether the org's subscription includes a module (`settings` is always core). */
export async function orgHasModule(orgId: string, moduleKey: string): Promise<boolean> {
  if (moduleKey === "settings") return true;
  return (await getEnabledModules(orgId)).has(moduleKey);
}
