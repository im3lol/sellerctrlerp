"use server";

import { withPlatformScope } from "@/lib/db-scope";
import { revalidatePath } from "@/lib/safe-revalidate";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { subscriptionRequests } from "@/db/schema";
import { requireCapability } from "@/lib/session";
import { activateFromRequest, type ActivateRes as Res } from "@/lib/saas/subscription-activate";

/** Owner approves a request → activates the org's subscription from the plan snapshot. */
export async function approveRequestAction(id: string): Promise<Res> {
  const actor = await requireCapability("employee.manage");
  return withPlatformScope(() => activateFromRequest(id, actor.id));
}

export async function rejectRequestAction(id: string, note?: string): Promise<Res> {
  const actor = await requireCapability("employee.manage");
  return withPlatformScope(async () => {
    const [req] = await db.select({ status: subscriptionRequests.status }).from(subscriptionRequests).where(eq(subscriptionRequests.id, id)).limit(1);
    if (!req) return { error: "الطلب غير موجود" };
    if (req.status !== "PENDING") return { error: "الطلب تمت مراجعته بالفعل" };
    await db.update(subscriptionRequests).set({ status: "REJECTED", note: note?.trim() || null, reviewedBy: actor.id, reviewedAt: new Date() }).where(eq(subscriptionRequests.id, id));
    revalidatePath("/admin/licensing");
    revalidatePath("/admin");
    return { ok: true };
  });
}
