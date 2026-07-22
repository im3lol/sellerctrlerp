"use server";

import { revalidatePath } from "@/lib/safe-revalidate";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { discountCoupons } from "@/db/schema";
import { requireCapability } from "@/lib/session";

type Res = { ok: true } | { error: string };

export type CouponInput = {
  id?: string;
  code: string;
  description?: string | null;
  discountType: string; // PERCENT | FIXED
  value: number;
  maxRedemptions?: number | null;
  expiresAt?: string | null;
  isActive?: boolean;
};

export async function upsertCouponAction(input: CouponInput): Promise<Res & { id?: string }> {
  await requireCapability("employee.manage");
  const code = input.code.trim().toUpperCase();
  if (!/^[A-Z0-9_-]{3,24}$/.test(code)) return { error: "الكود بحروف/أرقام إنجليزية (3-24)" };
  if (!["PERCENT", "FIXED"].includes(input.discountType)) return { error: "نوع خصم غير صحيح" };
  if (!(input.value > 0)) return { error: "قيمة الخصم يجب أن تكون أكبر من صفر" };
  if (input.discountType === "PERCENT" && input.value > 100) return { error: "نسبة الخصم لا تتجاوز 100%" };
  const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
  if (expiresAt && isNaN(expiresAt.getTime())) return { error: "تاريخ الانتهاء غير صالح" };

  const values = {
    code, description: input.description?.trim() || null, discountType: input.discountType,
    value: String(input.value), maxRedemptions: input.maxRedemptions ?? null,
    isActive: input.isActive ?? true, expiresAt, updatedAt: new Date(),
  };
  try {
    if (input.id) {
      await db.update(discountCoupons).set(values).where(eq(discountCoupons.id, input.id));
      revalidatePath("/admin/coupons"); return { ok: true, id: input.id };
    }
    const [row] = await db.insert(discountCoupons).values(values).returning({ id: discountCoupons.id });
    revalidatePath("/admin/coupons"); return { ok: true, id: row.id };
  } catch {
    return { error: "تعذّر الحفظ — قد يكون الكود مستخدماً" };
  }
}

export async function toggleCouponAction(id: string): Promise<Res> {
  await requireCapability("employee.manage");
  const [c] = await db.select({ isActive: discountCoupons.isActive }).from(discountCoupons).where(eq(discountCoupons.id, id)).limit(1);
  if (!c) return { error: "الكوبون غير موجود" };
  await db.update(discountCoupons).set({ isActive: !c.isActive, updatedAt: new Date() }).where(eq(discountCoupons.id, id));
  revalidatePath("/admin/coupons"); return { ok: true };
}

export async function deleteCouponAction(id: string): Promise<Res> {
  await requireCapability("employee.manage");
  await db.delete(discountCoupons).where(eq(discountCoupons.id, id));
  revalidatePath("/admin/coupons"); return { ok: true };
}
