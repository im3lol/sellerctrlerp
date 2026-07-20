"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { withPlatformScope } from "@/lib/db-scope";
import { getCurrentUser } from "@/lib/session";
import { getUserOrganizations, ACTIVE_ORG_COOKIE } from "@/lib/erp/org";
import { recordAudit } from "@/lib/erp/audit";

/**
 * Enter a tenant's workspace as the platform owner for support. A system_admin
 * already has full access to every org (org.ts) — this just selects the org, LOGS
 * the entry to the tenant's audit trail (unlike a silent org-switch), and drops the
 * admin into /dashboard. The support banner (app-shell) surfaces the mode + exit.
 */
export async function impersonateTenantAction(orgId: string): Promise<{ ok: false; error: string } | never> {
  const user = await getCurrentUser();
  if (!user || user.role !== "system_admin") return { ok: false, error: "غير مصرّح" };
  const target = (await getUserOrganizations(user)).find((o) => o.id === orgId);
  if (!target) return { ok: false, error: "المؤسسة غير موجودة" };

  // Short-lived (1 day) support selection — not the year-long cookie a normal switch sets.
  (await cookies()).set(ACTIVE_ORG_COOKIE, orgId, { path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 });
  await withPlatformScope(() => recordAudit(db, {
    orgId, userId: user.id, action: "IMPERSONATE", entityType: "ORGANIZATION", entityId: orgId,
    summary: `دخول المشرف للدعم — ${target.nameAr}`,
  }));
  redirect("/dashboard"); // outside any scope so its NEXT_REDIRECT throw doesn't roll back the audit
}

/** Leave support mode: clear the impersonation selection and return to /admin. */
export async function exitImpersonationAction(): Promise<never> {
  (await cookies()).delete(ACTIVE_ORG_COOKIE);
  redirect("/admin");
}
