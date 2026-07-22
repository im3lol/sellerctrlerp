"use server";

import { revalidatePath } from "@/lib/safe-revalidate";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { withOrgScope } from "@/lib/db-scope";
import { plans, subscriptionRequests } from "@/db/schema";
import { getActiveOrg } from "@/lib/erp/org";
import { getMemberAccess } from "@/lib/erp/auth-guard";
import { PAYMENT_METHODS } from "@/lib/erp/payment-info";

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

/** The tenant's latest subscription request (for status display). */
export async function getMyLatestRequest(orgId: string) {
  const [r] = await db.select().from(subscriptionRequests)
    .where(eq(subscriptionRequests.organizationId, orgId))
    .orderBy(desc(subscriptionRequests.createdAt)).limit(1);
  return r ?? null;
}
