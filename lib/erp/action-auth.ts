import { getActiveOrg } from "@/lib/erp/org";
import { getErpRole } from "@/lib/erp/auth-guard";
import { erpRoleHasPermission, type ErpPermission } from "@/lib/erp/permissions";

export type ActionState = { error?: string; ok?: boolean };

/**
 * Resolve the active org and enforce an ERP permission inside a server action.
 * Returns `{ orgId }` on success or `{ error }` (so callers can return it to the
 * form's useActionState instead of throwing).
 */
export async function authorizeErp(
  permission: ErpPermission,
): Promise<{ orgId: string; userId: string; role: string } | { error: string }> {
  const { user, org } = await getActiveOrg();
  if (!user) return { error: "غير مصرح بالدخول" };
  if (!org) return { error: "لم يتم تحديد المؤسسة" };
  const role = await getErpRole(org.id, user);
  if (!role) return { error: "غير مصرح بالوصول إلى هذه المؤسسة" };
  if (role !== "super_admin" && !erpRoleHasPermission(role, permission)) {
    return { error: "ليس لديك صلاحية لهذا الإجراء" };
  }
  return { orgId: org.id, userId: user.id, role };
}
