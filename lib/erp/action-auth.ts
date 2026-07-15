import { getActiveOrg } from "@/lib/erp/org";
import { getMemberAccess } from "@/lib/erp/auth-guard";
import { orgHasModule } from "@/lib/erp/entitlements";
import { type ErpPermission } from "@/lib/erp/permissions";
import { getErpContext } from "@/lib/erp/erp-context";

export type ActionState = { error?: string; ok?: boolean };

/**
 * Resolve the active org and enforce an ERP permission inside a server action.
 * Uses the caller's EFFECTIVE permissions (role ± per-user overrides). Returns
 * `{ orgId }` on success or `{ error }` (so callers can return it to the form's
 * useActionState instead of throwing).
 *
 * `moduleKey` additionally gates on a subscription module (e.g. "marketplace")
 * when it differs from the permission's own module. system_admin bypasses it.
 */
export async function authorizeErp(
  permission: ErpPermission,
  moduleKey?: string,
): Promise<{ orgId: string; userId: string; role: string } | { error: string }> {
  // Bearer API path: an ambient context was set by authorizeApi (no session cookie).
  const ctx = getErpContext();
  if (ctx) {
    if (!ctx.permissions.has(permission)) return { error: "ليس لديك صلاحية لهذا الإجراء" };
    if (moduleKey && ctx.role !== "system_admin" && !(await orgHasModule(ctx.orgId, moduleKey))) {
      return { error: "هذه الميزة غير مُفعّلة في باقتك" };
    }
    return { orgId: ctx.orgId, userId: ctx.userId, role: ctx.role };
  }

  const { user, org } = await getActiveOrg();
  if (!user) return { error: "غير مصرح بالدخول" };
  if (!org) return { error: "لم يتم تحديد المؤسسة" };
  const access = await getMemberAccess(org.id, user);
  if (!access.role) return { error: "غير مصرح بالوصول إلى هذه المؤسسة" };
  if (!access.permissions.has(permission)) {
    return { error: "ليس لديك صلاحية لهذا الإجراء" };
  }
  if (moduleKey && user.role !== "system_admin" && !(await orgHasModule(org.id, moduleKey))) {
    return { error: "هذه الميزة غير مُفعّلة في باقتك" };
  }
  return { orgId: org.id, userId: user.id, role: access.role };
}
