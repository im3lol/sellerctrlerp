"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "@/lib/safe-revalidate";
import { db } from "@/lib/db";
import { organizations } from "@/db/schema";
import { withOrgScope } from "@/lib/db-scope";
import { authorizeErp } from "@/lib/erp/action-auth";
import { tryRecordAudit } from "@/lib/erp/audit";

type Result = { ok: true } | { ok: false; error: string };

/** Owner-only: schedule the active company for deletion (typed name as confirmation). */
export async function requestOrgDeletionAction(confirmName: string): Promise<Result> {
  const auth = await authorizeErp("settings.edit");
  if ("error" in auth) return { ok: false, error: auth.error };
  if (auth.role !== "admin") return { ok: false, error: "مالك الشركة بس اللي يقدر يطلب حذفها" };
  return withOrgScope(auth.orgId, false, async () => {
    const [org] = await db.select({ name: organizations.nameAr }).from(organizations).where(eq(organizations.id, auth.orgId)).limit(1);
    if (!org || confirmName.trim() !== org.name.trim()) return { ok: false as const, error: "اسم الشركة مش مطابق — اكتبه بالظبط" };
    await db.update(organizations).set({ deletionRequestedAt: new Date() }).where(eq(organizations.id, auth.orgId));
    await tryRecordAudit({ orgId: auth.orgId, userId: auth.userId, action: "UPDATE", entityType: "organization", entityId: auth.orgId, summary: "طلب حذف الشركة" });
    revalidatePath("/", "layout");
    return { ok: true as const };
  });
}

export async function cancelOrgDeletionAction(): Promise<Result> {
  const auth = await authorizeErp("settings.edit");
  if ("error" in auth) return { ok: false, error: auth.error };
  if (auth.role !== "admin") return { ok: false, error: "مالك الشركة بس اللي يقدر يلغي الطلب" };
  await withOrgScope(auth.orgId, false, async () => {
    await db.update(organizations).set({ deletionRequestedAt: null }).where(eq(organizations.id, auth.orgId));
    await tryRecordAudit({ orgId: auth.orgId, userId: auth.userId, action: "UPDATE", entityType: "organization", entityId: auth.orgId, summary: "إلغاء طلب حذف الشركة" });
  });
  revalidatePath("/", "layout");
  return { ok: true };
}
