"use server";

import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { withPlatformScope } from "@/lib/db-scope";
import { organizations } from "@/db/schema";
import { getCurrentUser } from "@/lib/session";
import { ACTIVE_ORG_COOKIE } from "@/lib/erp/org";
import { revalidatePath } from "@/lib/safe-revalidate";

/**
 * Permanently delete a tenant organization AND all of its data. Every org-scoped
 * table has an `organization_id` FK with ON DELETE CASCADE, so a single delete on
 * `organizations` removes everything (documents, accounting, inventory, members,
 * subscriptions, credentials…). IRREVERSIBLE.
 *
 * Guards: system_admin only (platform owner), and the exact org name must be typed
 * to confirm. If the deleted org happened to be the admin's active-org selection
 * (e.g. after «دخول للدعم»), the stale cookie is cleared so the session doesn't
 * point at a ghost org.
 *
 * ponytail: DB cascade only. Orphaned S3/MinIO objects (backup archives, uploaded
 * logos/attachments) are left — cheap storage; add a bucket sweep only if it matters.
 */
export async function deleteTenantAction(input: { orgId: string; confirmName: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await getCurrentUser();
  if (!user || user.role !== "system_admin") return { ok: false, error: "غير مصرّح" };

  const [org] = await withPlatformScope(() =>
    db.select({ id: organizations.id, nameAr: organizations.nameAr }).from(organizations).where(eq(organizations.id, input.orgId)).limit(1));
  if (!org) return { ok: false, error: "المؤسسة غير موجودة" };
  if (input.confirmName.trim() !== org.nameAr.trim()) return { ok: false, error: "اسم المؤسسة غير مطابق — اكتبه بالضبط للتأكيد" };

  console.warn(`[admin] system_admin ${user.id} permanently deleting org "${org.nameAr}" (${org.id})`);
  await withPlatformScope(() => db.delete(organizations).where(eq(organizations.id, org.id)));

  // Drop a stale active-org selection so the next request doesn't resolve a ghost org.
  const jar = await cookies();
  if (jar.get(ACTIVE_ORG_COOKIE)?.value === org.id) jar.delete(ACTIVE_ORG_COOKIE);

  revalidatePath("/admin/licensing");
  revalidatePath("/admin");
  return { ok: true };
}
