import { and, eq, gte, isNull, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { discountCoupons } from "@/db/schema";

/** Resolve a redeemable coupon by code (active, not expired, under its cap). */
export async function findRedeemableCoupon(code: string) {
  const [c] = await db.select().from(discountCoupons)
    .where(and(
      eq(discountCoupons.code, code.trim().toUpperCase()),
      eq(discountCoupons.isActive, true),
      or(isNull(discountCoupons.expiresAt), gte(discountCoupons.expiresAt, new Date()))!,
    )).limit(1);
  if (!c) return null;
  if (c.maxRedemptions != null && c.redemptions >= c.maxRedemptions) return null;
  return c;
}

/** Apply a coupon's discount to a price (2dp, never below 0). */
export function applyDiscount(price: number, discountType: string, value: number): number {
  const p = discountType === "PERCENT" ? price * (1 - value / 100) : price - value;
  return Math.max(0, Math.round(p * 100) / 100);
}

export async function incrementRedemption(id: string): Promise<void> {
  await db.update(discountCoupons).set({ redemptions: sql`${discountCoupons.redemptions} + 1`, updatedAt: new Date() }).where(eq(discountCoupons.id, id));
}
