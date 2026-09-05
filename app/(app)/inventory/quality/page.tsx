import { and, asc, eq } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { items } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { QualityManager } from "@/components/erp/quality-manager";

export default async function QualityPage() {
  return loadErpPage("inventory.view", async ({ orgId, can }) => {
    const itemList = await db
      .select({ id: items.id, code: items.code, nameAr: items.nameAr, requiresInspection: items.requiresInspection })
      .from(items)
      .where(and(eq(items.organizationId, orgId), eq(items.isActive, true)))
      .orderBy(asc(items.code))
      .limit(2000);

    return (
      <div className="space-y-6">
        <ErpPageHeader
          icon="ShieldCheck"
          title="فحص الجودة"
          subtitle="البضاعة تحت الفحص بتقعد في الحجر — على الدفاتر بتكلفتها، ومش متاحة للبيع"
          backHref="/inventory"
        />
        <QualityManager
          canDecide={can("inventory.confirm")}
          canEdit={can("inventory.edit")}
          items={itemList.map((i) => ({
            id: i.id,
            label: `${i.code} — ${i.nameAr ?? ""}`,
            requiresInspection: i.requiresInspection,
          }))}
        />
      </div>
    );
  });
}
