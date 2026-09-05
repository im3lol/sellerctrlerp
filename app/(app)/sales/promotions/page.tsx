import { asc, eq } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { promotions, items, organizations } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { PromotionsManager } from "@/components/erp/promotions-manager";
import type { Promotion } from "@/lib/erp/promotions";

export default async function PromotionsPage() {
  return loadErpPage("sales.view", async ({ orgId, can }) => {
    const [rows, itemList, org] = await Promise.all([
      db.select({
        id: promotions.id, code: promotions.code, nameAr: promotions.nameAr, type: promotions.type,
        value: promotions.value, itemId: promotions.itemId,
        minQuantity: promotions.minQuantity, minAmount: promotions.minAmount,
        buyQty: promotions.buyQty, getQty: promotions.getQty,
        startsAt: promotions.startsAt, endsAt: promotions.endsAt,
        priority: promotions.priority, isActive: promotions.isActive, notes: promotions.notes,
        itemCode: items.code, itemName: items.nameAr,
      }).from(promotions)
        .leftJoin(items, eq(items.id, promotions.itemId))
        .where(eq(promotions.organizationId, orgId))
        .orderBy(asc(promotions.code)),

      db.select({ id: items.id, code: items.code, nameAr: items.nameAr })
        .from(items).where(eq(items.organizationId, orgId)).orderBy(asc(items.code)).limit(2000),

      db.select({
        earn: organizations.loyaltyEarnRate,
        redeem: organizations.loyaltyRedeemRate,
        minRedeem: organizations.loyaltyMinRedeem,
      }).from(organizations).where(eq(organizations.id, orgId)).limit(1),
    ]);

    return (
      <div className="space-y-6">
        <ErpPageHeader
          icon="BadgePercent"
          title="العروض ونقط الولاء"
          subtitle="خصومات بتشتغل لوحدها على الكاشير، ونقط العميل بيكسبها ويصرفها"
          backHref="/sales"
        />
        <PromotionsManager
          rows={rows.map((r) => ({
            id: r.id, code: r.code, nameAr: r.nameAr,
            type: r.type as Promotion["type"], value: Number(r.value), itemId: r.itemId,
            minQuantity: Number(r.minQuantity), minAmount: Number(r.minAmount),
            buyQty: r.buyQty, getQty: r.getQty,
            startsAt: r.startsAt, endsAt: r.endsAt, priority: r.priority,
            isActive: r.isActive, notes: r.notes,
            itemLabel: r.itemCode ? `${r.itemCode} — ${r.itemName}` : null,
          }))}
          items={itemList.map((i) => ({ id: i.id, label: `${i.code} — ${i.nameAr ?? ""}` }))}
          loyalty={{
            earnRate: Number(org[0]?.earn ?? 0),
            redeemRate: Number(org[0]?.redeem ?? 0),
            minRedeem: Number(org[0]?.minRedeem ?? 0),
          }}
          canManage={can("sales.create")}
          canEditSettings={can("settings.edit")}
        />
      </div>
    );
  });
}
