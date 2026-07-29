"use server";

import { revalidatePath } from "@/lib/safe-revalidate";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { withOrgScope } from "@/lib/db-scope";
import { plans, subscriptionRequests } from "@/db/schema";
import { getActiveOrg } from "@/lib/erp/org";
import { getMemberAccess } from "@/lib/erp/auth-guard";
import { PAYMENT_METHODS } from "@/lib/erp/payment-info";
import { getXpayConfig, createCheckoutSession } from "@/lib/saas/xpay";

type Res = { ok: true } | { error: string };

export type SubRequestInput = {
  planId: string;
  interval: string;          // MONTHLY | ANNUAL
  paymentMethod: string;     // INSTAPAY | BANK | VISA
  paymentReference?: string;
  note?: string;
};

/** Tenant submits a request to subscribe to a plan (owner approves it in admin). */
export async function requestSubscriptionAction(input: SubRequestInput): Promise<Res> {
  const { user, org } = await getActiveOrg();
  if (!user || !org) return { error: "غير مصرح" };
  // Only an org admin may request a subscription for the company.
  const access = await getMemberAccess(org.id, user);
  if (access.role !== "admin" && access.role !== "super_admin" && user.role !== "system_admin") {
    return { error: "صلاحية مدير المؤسسة مطلوبة لطلب الاشتراك" };
  }

  const method = PAYMENT_METHODS.find((m) => m.key === input.paymentMethod);
  if (!method || !method.enabled) return { error: "طريقة دفع غير متاحة" };
  if (input.interval !== "MONTHLY" && input.interval !== "ANNUAL") return { error: "دورة غير صحيحة" };

  return withOrgScope(org.id, false, async () => {
    const [plan] = await db.select().from(plans).where(and(eq(plans.id, input.planId), eq(plans.isActive, true))).limit(1);
    if (!plan) return { error: "الباقة غير موجودة" };

    // One open request at a time.
    const [pending] = await db.select({ id: subscriptionRequests.id }).from(subscriptionRequests)
      .where(and(eq(subscriptionRequests.organizationId, org.id), eq(subscriptionRequests.status, "PENDING"))).limit(1);
    if (pending) return { error: "لديك طلب اشتراك قيد المراجعة بالفعل" };

    const price = input.interval === "ANNUAL" ? plan.priceAnnual : plan.priceMonthly;
    await db.insert(subscriptionRequests).values({
      organizationId: org.id,
      planId: plan.id,
      planName: plan.name,
      interval: input.interval,
      price: String(price),
      paymentMethod: input.paymentMethod,
      paymentReference: input.paymentReference?.trim() || null,
      note: input.note?.trim() || null,
      requestedBy: user.id,
    });

    revalidatePath("/settings/subscription");
    return { ok: true };
  });
}

export type XpayStartInput = { planId: string; interval: string };
export type XpayStartResult =
  | { ok: true; mode: "dropin"; clientSecret: string; publishableKey: string; baseUrl: string }
  | { ok: true; mode: "redirect"; url: string }
  | { error: string };

/**
 * Start an xpay checkout for a plan: create a PENDING request, open a checkout session,
 * stash the session id on the request (so the webhook/return matches it). When a
 * publishable key is configured we return a `clientSecret` for the DROP-IN modal (paid
 * on our own domain); otherwise a hosted `url` to redirect to. Rolls the request back if
 * xpay rejects it (so it doesn't block the one-open-request rule).
 */
export async function startXpaySubscriptionAction(input: XpayStartInput): Promise<XpayStartResult> {
  const { user, org } = await getActiveOrg();
  if (!user || !org) return { error: "غير مصرح" };
  const access = await getMemberAccess(org.id, user);
  if (access.role !== "admin" && access.role !== "super_admin" && user.role !== "system_admin") {
    return { error: "صلاحية مدير المؤسسة مطلوبة لطلب الاشتراك" };
  }
  const cfg = await getXpayConfig();
  if (!cfg) return { error: "الدفع الإلكتروني غير مُفعّل حاليًا — استخدم إنستا باي أو فودافون كاش" };
  if (input.interval !== "MONTHLY" && input.interval !== "ANNUAL") return { error: "دورة غير صحيحة" };
  const base = process.env.APP_URL;
  if (!base) return { error: "تعذّر تحديد رابط النظام (APP_URL) — تواصل مع الدعم" };
  const dropIn = !!cfg.publishableKey; // drop-in when a publishable key is set, else hosted redirect

  return withOrgScope(org.id, false, async () => {
    const [plan] = await db.select().from(plans).where(and(eq(plans.id, input.planId), eq(plans.isActive, true))).limit(1);
    if (!plan) return { error: "الباقة غير موجودة" };
    const [pending] = await db.select({ id: subscriptionRequests.id }).from(subscriptionRequests)
      .where(and(eq(subscriptionRequests.organizationId, org.id), eq(subscriptionRequests.status, "PENDING"))).limit(1);
    if (pending) return { error: "لديك طلب اشتراك قيد المراجعة بالفعل" };

    const price = Number(input.interval === "ANNUAL" ? plan.priceAnnual : plan.priceMonthly);
    const [reqRow] = await db.insert(subscriptionRequests).values({
      organizationId: org.id, planId: plan.id, planName: plan.name, interval: input.interval,
      price: String(price), paymentMethod: "XPAY", requestedBy: user.id,
    }).returning({ id: subscriptionRequests.id });

    try {
      const session = await createCheckoutSession({
        amount: price, currency: "EGP", name: `اشتراك ${plan.name} (${input.interval === "ANNUAL" ? "سنوي" : "شهري"})`,
        redirectUrl: `${base.replace(/\/$/, "")}/api/subscription/xpay/return?session_id={CHECKOUT_SESSION_ID}`,
        metadata: { subscription_request_id: reqRow.id, organization_id: org.id },
        ...(dropIn ? { uiMode: "embedded" as const } : {}),
      });
      // Stash the session id so the webhook/return can match this payment to the request.
      await db.update(subscriptionRequests).set({ paymentReference: session.id }).where(eq(subscriptionRequests.id, reqRow.id));
      if (dropIn && session.clientSecret) return { ok: true, mode: "dropin", clientSecret: session.clientSecret, publishableKey: cfg.publishableKey, baseUrl: cfg.baseUrl };
      return { ok: true, mode: "redirect", url: session.url };
    } catch (e) {
      await db.delete(subscriptionRequests).where(eq(subscriptionRequests.id, reqRow.id)); // don't leave a blocking PENDING
      return { error: e instanceof Error ? e.message : "تعذّر بدء الدفع الإلكتروني" };
    }
  });
}

/** The tenant's latest subscription request (for status display). */
export async function getMyLatestRequest(orgId: string) {
  const [r] = await db.select().from(subscriptionRequests)
    .where(eq(subscriptionRequests.organizationId, orgId))
    .orderBy(desc(subscriptionRequests.createdAt)).limit(1);
  return r ?? null;
}
