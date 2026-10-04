import { desc } from "drizzle-orm";
import { getT } from "@/lib/i18n/server";
import { db } from "@/lib/db";
import { discountCoupons } from "@/db/schema";
import { PageHeader } from "@/components/page-header";
import { CouponsManager } from "@/components/admin/coupons-manager";

export default async function CouponsPage() {
  const t = await getT();
  const rows = await db.select().from(discountCoupons).orderBy(desc(discountCoupons.createdAt));
  const coupons = rows.map((c) => ({
    id: c.id, code: c.code, description: c.description ?? "", discountType: c.discountType,
    value: Number(c.value), isActive: c.isActive, maxRedemptions: c.maxRedemptions,
    redemptions: c.redemptions, expiresAt: c.expiresAt ? new Date(c.expiresAt).toISOString().slice(0, 10) : "",
  }));
  return (
    <div className="space-y-6">
      <PageHeader title={t("كوبونات الخصم")} description={t("أكواد خصم تُطبَّق على سعر الاشتراك عند التفعيل.")} />
      <CouponsManager coupons={coupons} />
    </div>
  );
}
