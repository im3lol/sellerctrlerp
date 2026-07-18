"use server";

import { withPlatformScope } from "@/lib/db-scope";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { orgSubscriptions } from "@/db/schema";
import { requireCapability, getCurrentUser } from "@/lib/session";
import { ALL_MODULES } from "@/lib/erp/module-list";
import { findRedeemableCoupon, applyDiscount, incrementRedemption } from "@/lib/erp/coupons";
import { isLiveRevenue, normalizeMrr, classifyTransition, recordSubscriptionEvent } from "@/lib/erp/platform-metrics";

const STATUSES = ["NONE", "TRIAL", "ACTIVE", "EXPIRED", "CANCELLED"];

export type SubInput = {
  organizationId: string;
  status: string;
  planId?: string | null;
  planName?: string | null;
  interval?: string | null;
  price?: number;
  expiresAt?: string | null; // yyyy-mm-dd
  enabledModules: string[];
  maxUsers?: number | null;   // null = unlimited
  storageGb?: number | null;  // null = unlimited
  couponCode?: string | null;
};

/** Owner-only: set an organization's subscription/entitlement (activation),
 *  optionally applying a discount coupon to the price. */
export async function setSubscriptionAction(input: SubInput): Promise<{ ok: true; discounted?: number } | { error: string }> {
  await requireCapability("employee.manage");
  return withPlatformScope(async () => {
    if (!input.organizationId) return { error: "مؤسسة غير محددة" };
    if (!STATUSES.includes(input.status)) return { error: "حالة غير صحيحة" };

    const modules = input.enabledModules.filter((m) => (ALL_MODULES as readonly string[]).includes(m));
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
    if (expiresAt && isNaN(expiresAt.getTime())) return { error: "تاريخ الانتهاء غير صالح" };

    let price = input.price ?? 0;
    let couponId: string | null = null;
    if (input.couponCode?.trim()) {
      const coupon = await findRedeemableCoupon(input.couponCode);
      if (!coupon) return { error: "الكوبون غير صالح أو منتهٍ أو مستنفد" };
      // Consume the redemption atomically up front — closes the TOCTOU where two
      // concurrent redemptions both pass findRedeemableCoupon's read-side cap check.
      if (!(await incrementRedemption(coupon.id))) return { error: "الكوبون مستنفد" };
      price = applyDiscount(price, coupon.discountType, Number(coupon.value));
      couponId = coupon.id;
    }

    const values = {
      organizationId: input.organizationId,
      status: input.status,
      planId: input.planId || null,
      planName: input.planName?.trim() || null,
      interval: input.interval || null,
      price: String(price),
      enabledModules: modules,
      maxUsers: input.maxUsers != null && input.maxUsers > 0 ? Math.floor(input.maxUsers) : null,
      storageGb: input.storageGb != null && input.storageGb > 0 ? Math.floor(input.storageGb) : null,
      expiresAt,
      activatedByCodeId: couponId,
      startedAt: input.status === "ACTIVE" || input.status === "TRIAL" ? new Date() : null,
      updatedAt: new Date(),
    };

    // Capture the prior MRR contribution BEFORE the upsert, to log the movement.
    const now = new Date();
    const [prev] = await db.select({ status: orgSubscriptions.status, price: orgSubscriptions.price, interval: orgSubscriptions.interval, expiresAt: orgSubscriptions.expiresAt })
      .from(orgSubscriptions).where(eq(orgSubscriptions.organizationId, input.organizationId)).limit(1);
    const oldLive = prev ? isLiveRevenue(prev.status, prev.expiresAt ? new Date(prev.expiresAt) : null, now) : false;
    const oldMrr = oldLive ? normalizeMrr(Number(prev!.price), prev!.interval) : 0;
    const newLive = isLiveRevenue(input.status, expiresAt, now);
    const newMrr = newLive ? normalizeMrr(price, input.interval ?? null) : 0;

    await db.insert(orgSubscriptions).values(values)
      .onConflictDoUpdate({ target: orgSubscriptions.organizationId, set: values });

    const type = classifyTransition({ oldMrr, newMrr, oldLive, newLive, newStatus: input.status });
    if (type) {
      const me = await getCurrentUser();
      await recordSubscriptionEvent(db, { orgId: input.organizationId, type, planName: values.planName, interval: values.interval, mrrBefore: oldMrr, mrrAfter: newMrr, byUserId: me?.id ?? null, at: now });
    }
    revalidatePath("/admin/licensing");
    return { ok: true, discounted: couponId ? price : undefined };
  });
}
