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

/**
 * Atomically consume one redemption, enforcing the cap in the WHERE clause so two
 * concurrent redemptions can't both pass the read-side check in findRedeemableCoupon
 * and over-redeem. Returns false when the cap is already reached (lost the race).
 */
export async function incrementRedemption(id: string): Promise<boolean> {
  const rows = await db.update(discountCoupons)
    .set({ redemptions: sql`${discountCoupons.redemptions} + 1`, updatedAt: new Date() })
    .where(and(
      eq(discountCoupons.id, id),
      or(isNull(discountCoupons.maxRedemptions), sql`${discountCoupons.redemptions} < ${discountCoupons.maxRedemptions}`)!,
    ))
    .returning({ id: discountCoupons.id });
  return rows.length > 0;
}
