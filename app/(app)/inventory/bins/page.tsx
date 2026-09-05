import { and, asc, eq } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { items, warehouses } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { BinsManager } from "@/components/erp/bins-manager";

export default async function BinsPage() {
  return loadErpPage("inventory.view", async ({ orgId, can }) => {
    const [whList, itemList] = await Promise.all([
      db.select({ id: warehouses.id, nameAr: warehouses.nameAr })
        .from(warehouses).where(and(eq(warehouses.organizationId, orgId), eq(warehouses.isActive, true)))
        .orderBy(asc(warehouses.nameAr)),
      db.select({ id: items.id, code: items.code, nameAr: items.nameAr })
        .from(items).where(and(eq(items.organizationId, orgId), eq(items.isActive, true)))
        .orderBy(asc(items.code)).limit(2000),
    ]);

    return (
      <div className="space-y-6">
        <ErpPageHeader
          icon="Grid3x3"
          title="مواقع التخزين"
          subtitle="فين تلاقي الصنف جوّه المخزن — الأرصدة بتفضل على مستوى المستودع"
          backHref="/inventory"
        />

        {whList.length === 0 ? (
          <Card><CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">مفيش مستودعات مفعّلة — أضف مستودع الأول.</p>
          </CardContent></Card>
        ) : (
          <BinsManager
            canEdit={can("inventory.edit")}
            warehouses={whList.map((w) => ({ id: w.id, label: w.nameAr }))}
            items={itemList.map((i) => ({ id: i.id, label: `${i.code} — ${i.nameAr ?? ""}` }))}
          />
        )}
      </div>
    );
  });
}
