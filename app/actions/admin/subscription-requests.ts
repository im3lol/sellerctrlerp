"use server";

import { withPlatformScope } from "@/lib/db-scope";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { plans, orgSubscriptions, subscriptionRequests } from "@/db/schema";
import { requireCapability } from "@/lib/session";

type Res = { ok: true } | { error: string };

function addInterval(from: Date, interval: string): Date {
  const d = new Date(from);
  if (interval === "ANNUAL") d.setFullYear(d.getFullYear() + 1);
  else d.setMonth(d.getMonth() + 1);
  return d;
}

/** Owner approves a request → activates the org's subscription from the plan snapshot. */
export async function approveRequestAction(id: string): Promise<Res> {
  const actor = await requireCapability("employee.manage");
  return withPlatformScope(async () => {
    const [req] = await db.select().from(subscriptionRequests).where(eq(subscriptionRequests.id, id)).limit(1);
    if (!req) return { error: "الطلب غير موجود" };
    if (req.status !== "PENDING") return { error: "الطلب تمت مراجعته بالفعل" };

    // Snapshot caps/modules from the (still-current) plan if it exists; fall back to the request.
    const [plan] = req.planId ? await db.select().from(plans).where(eq(plans.id, req.planId)).limit(1) : [undefined];
    const now = new Date();
    const values = {
      organizationId: req.organizationId,
      status: "ACTIVE",
      planId: req.planId,
      planName: req.planName,
      interval: req.interval,
      price: req.price,
      enabledModules: plan?.enabledModules ?? [],
      maxUsers: plan?.maxUsers ?? null,
      storageGb: plan?.storageGb ?? null,
      startedAt: now,
      expiresAt: addInterval(now, req.interval),
      updatedAt: now,
    };
    await db.insert(orgSubscriptions).values(values).onConflictDoUpdate({ target: orgSubscriptions.organizationId, set: values });
    await db.update(subscriptionRequests).set({ status: "APPROVED", reviewedBy: actor.id, reviewedAt: now }).where(eq(subscriptionRequests.id, id));

    revalidatePath("/admin/licensing");
    revalidatePath("/admin");
    return { ok: true };
  });
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
