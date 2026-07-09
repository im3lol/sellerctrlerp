import { desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { discountCoupons } from "@/db/schema";
import { CouponsManager } from "@/components/admin/coupons-manager";

export default async function CouponsPage() {
  const rows = await db.select().from(discountCoupons).orderBy(desc(discountCoupons.createdAt));
  const coupons = rows.map((c) => ({
    id: c.id, code: c.code, description: c.description ?? "", discountType: c.discountType,
    value: Number(c.value), isActive: c.isActive, maxRedemptions: c.maxRedemptions,
    redemptions: c.redemptions, expiresAt: c.expiresAt ? new Date(c.expiresAt).toISOString().slice(0, 10) : "",
  }));
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">كوبونات الخصم</h1>
        <p className="text-muted-foreground">أكواد خصم تُطبَّق على سعر الاشتراك عند التفعيل.</p>
      </div>
      <CouponsManager coupons={coupons} />
    </div>
  );
}
