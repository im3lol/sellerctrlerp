"use server";

import { withPlatformScope } from "@/lib/db-scope";
import { revalidatePath } from "@/lib/safe-revalidate";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { plans, orgSubscriptions, subscriptionRequests, subscriptionPayments, organizations } from "@/db/schema";
import { sendEmail } from "@/lib/erp/email";
import { receiptEmail } from "@/lib/saas/email-templates";
import { requireCapability } from "@/lib/session";
import { isLiveRevenue, normalizeMrr, classifyTransition, recordSubscriptionEvent } from "@/lib/erp/platform-metrics";

type Res = { ok: true } | { error: string };

function addInterval(from: Date, interval: string): Date {
  const d = new Date(from);
  if (interval === "ANNUAL") d.setFullYear(d.getFullYear() + 1);
  else d.setMonth(d.getMonth() + 1);
  return d;
}

/**
 * Turn a PENDING request into an ACTIVE subscription: snapshot the plan, upsert the
 * org subscription, log the MRR movement, and record the collection. Shared by the
 * owner's manual approve AND the xpay callback (actorId=null → auto). Idempotent: an
 * already-APPROVED request no-ops. `paidAmount` (gateway) must cover the plan price —
 * a tamper guard. MUST run inside withPlatformScope.
 */
export async function activateFromRequest(reqId: string, actorId: string | null, opts?: { paidAmount?: number }): Promise<Res> {
  const [req] = await db.select().from(subscriptionRequests).where(eq(subscriptionRequests.id, reqId)).limit(1);
  if (!req) return { error: "الطلب غير موجود" };
  if (req.status === "APPROVED") return { ok: true }; // already activated — idempotent (double callback)
  if (req.status !== "PENDING") return { error: "الطلب تمت مراجعته بالفعل" };
  // Gateway tamper guard: the charged amount (price + fees) must at least cover the plan price.
  if (opts?.paidAmount != null && opts.paidAmount + 0.01 < Number(req.price)) return { error: "المبلغ المدفوع أقل من قيمة الباقة" };

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
  // Prior MRR contribution, to log the activation/renewal/upgrade movement.
  const [prev] = await db.select({ status: orgSubscriptions.status, price: orgSubscriptions.price, interval: orgSubscriptions.interval, expiresAt: orgSubscriptions.expiresAt })
    .from(orgSubscriptions).where(eq(orgSubscriptions.organizationId, req.organizationId)).limit(1);
  const oldLive = prev ? isLiveRevenue(prev.status, prev.expiresAt ? new Date(prev.expiresAt) : null, now) : false;
  const oldMrr = oldLive ? normalizeMrr(Number(prev!.price), prev!.interval) : 0;
  const newMrr = normalizeMrr(Number(req.price), req.interval); // activate always → live ACTIVE

  await db.insert(orgSubscriptions).values(values).onConflictDoUpdate({ target: orgSubscriptions.organizationId, set: values });
  await db.update(subscriptionRequests).set({ status: "APPROVED", reviewedBy: actorId, reviewedAt: now }).where(eq(subscriptionRequests.id, reqId));

  const type = classifyTransition({ oldMrr, newMrr, oldLive, newLive: true, newStatus: "ACTIVE" });
  if (type) await recordSubscriptionEvent(db, { orgId: req.organizationId, type, planName: req.planName, interval: req.interval, mrrBefore: oldMrr, mrrAfter: newMrr, byUserId: actorId, note: "من طلب اشتراك", at: now });

  // Record the collection the request settles → realized-revenue ledger.
  await db.insert(subscriptionPayments).values({
    organizationId: req.organizationId, amount: req.price, currency: "EGP", method: req.paymentMethod,
    reference: req.paymentReference, paidAt: now, periodStart: now.toISOString().slice(0, 10),
    periodEnd: values.expiresAt.toISOString().slice(0, 10), subscriptionRequestId: req.id,
    note: actorId ? "تفعيل من طلب اشتراك" : "دفع إلكتروني (xpay)", recordedBy: actorId,
  });

  // Best-effort payment receipt to the org's email (never blocks activation; no-ops
  // if SMTP isn't configured or the org has no email on file).
  try {
    const [org] = await db.select({ name: organizations.nameAr, email: organizations.email })
      .from(organizations).where(eq(organizations.id, req.organizationId)).limit(1);
    if (org?.email) {
      const mail = receiptEmail({
        orgName: org.name, planName: req.planName, interval: req.interval,
        amount: Number(req.price), expiresAt: values.expiresAt, appUrl: process.env.APP_URL || "",
      });
      await sendEmail({ to: org.email, subject: mail.subject, html: mail.html, text: mail.text });
    }
  } catch (e) { console.error("[receipt-email]", e); }

  revalidatePath("/admin/licensing");
  revalidatePath("/admin/collections");
  revalidatePath("/admin");
  return { ok: true };
}

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
