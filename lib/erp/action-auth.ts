import { getActiveOrg } from "@/lib/erp/org";
import { getMemberAccess } from "@/lib/erp/auth-guard";
import { orgHasModule } from "@/lib/erp/entitlements";
import { type ErpPermission } from "@/lib/erp/permissions";
import { getErpContext } from "@/lib/erp/erp-context";
import { withOrgScope, withPlatformScope } from "@/lib/db-scope";

export type ActionState = { error?: string; ok?: boolean };
export type ErpActionCtx = { orgId: string; userId: string; role: string };

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

  // One transaction for the whole bootstrap instead of two. getActiveOrg opens a platform
  // scope (it lists memberships ACROSS orgs, so it cannot be org-scoped) and getMemberAccess
  // opened a second, org-scoped one straight after — every action paid two BEGIN/COMMIT
  // round trips before touching its own data. Both wrappers reuse an already-open scope, so
  // hoisting one platform scope around the pair collapses them into a single transaction.
  //
  // getMemberAccess therefore reads its membership row with RLS bypassed. That is the same
  // control getUserOrganizations already documents and relies on: the row is pinned by an
  // explicit (organization_id, user_id) filter, and a user who is not a member simply gets
  // no row — which is exactly what the org-scoped policy did. The tenant scope the action
  // body runs in is unaffected; it opens after this returns.
  return withPlatformScope(async () => {
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
  });
}

/**
 * Wrap a server action: authorize, then run its body inside the tenant DB scope so
 * every query is RLS-isolated. Returns the action's error shape when authorization
 * fails (so `useActionState` still gets it) and otherwise the handler's result.
 *
 * `isAdmin` is always false here — even a system_admin operating in the tenant UI has
 * picked one org via the cookie, so the cross-org bypass is reserved for /admin.
 *
 *   export const fooAction = (input: unknown) =>
 *     withErpAction("sales.create", ({ orgId }) => coreFoo(orgId, input));
 */
export async function withErpAction<T>(
  permission: ErpPermission,
  handler: (ctx: ErpActionCtx) => Promise<T>,
  moduleKey?: string,
): Promise<T | { error: string }> {
  const auth = await authorizeErp(permission, moduleKey);
  if ("error" in auth) return auth;
  return withOrgScope(auth.orgId, false, () => handler(auth));
}
