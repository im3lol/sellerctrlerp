import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { getActiveOrg } from "@/lib/erp/org";
import { orgHasModule } from "@/lib/erp/entitlements";
import type { SessionUser } from "@/lib/session";

export type HrContext = { user: SessionUser; orgId: string | null };

/**
 * Gate for HR pages (attendance, leaderboard, academy).
 * - system_admin bypasses (can view any org for support).
 * - Any other user must have an active org with the `hr` module enabled.
 * Returns orgId (needed by leaderboard/team queries); null for system_admin.
 */
export async function requireHrAccess(): Promise<HrContext> {
  const user = await requireUser();
  if (user.role === "system_admin") return { user, orgId: null };

  const { org } = await getActiveOrg();
  if (!org) redirect("/dashboard");
  if (!(await orgHasModule(org.id, "hr"))) redirect("/dashboard?locked=hr");

  return { user, orgId: org.id };
}
