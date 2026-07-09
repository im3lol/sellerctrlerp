"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { orgSubscriptions } from "@/db/schema";
import { requireCapability } from "@/lib/session";
import { ALL_MODULES } from "@/lib/erp/module-list";
import { findRedeemableCoupon, applyDiscount, incrementRedemption } from "@/lib/erp/coupons";

const STATUSES = ["NONE", "TRIAL", "ACTIVE", "EXPIRED", "CANCELLED"];

export type SubInput = {
  organizationId: string;
  status: string;
  planName?: string | null;
  interval?: string | null;
  price?: number;
  expiresAt?: string | null; // yyyy-mm-dd
  enabledModules: string[];
  couponCode?: string | null;
};

/** Owner-only: set an organization's subscription/entitlement (activation),
 *  optionally applying a discount coupon to the price. */
export async function setSubscriptionAction(input: SubInput): Promise<{ ok: true; discounted?: number } | { error: string }> {
  await requireCapability("employee.manage");
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
    price = applyDiscount(price, coupon.discountType, Number(coupon.value));
    couponId = coupon.id;
  }

  const values = {
    organizationId: input.organizationId,
    status: input.status,
    planName: input.planName?.trim() || null,
    interval: input.interval || null,
    price: String(price),
    enabledModules: modules,
    expiresAt,
    activatedByCodeId: couponId,
    startedAt: input.status === "ACTIVE" || input.status === "TRIAL" ? new Date() : null,
    updatedAt: new Date(),
  };

  await db.insert(orgSubscriptions).values(values)
    .onConflictDoUpdate({ target: orgSubscriptions.organizationId, set: values });
  if (couponId) await incrementRedemption(couponId);
  revalidatePath("/admin/licensing");
  return { ok: true, discounted: couponId ? price : undefined };
}
