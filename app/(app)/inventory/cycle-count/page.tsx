import { and, asc, eq } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { warehouses } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { CycleCountManager } from "@/components/erp/cycle-count-manager";

export default async function CycleCountPage() {
  return loadErpPage("inventory.view", async ({ orgId, can }) => {
    const whList = await db
      .select({ id: warehouses.id, nameAr: warehouses.nameAr })
      .from(warehouses)
      .where(and(eq(warehouses.organizationId, orgId), eq(warehouses.isActive, true)))
      .orderBy(asc(warehouses.nameAr));

    return (
      <div className="space-y-6">
        <ErpPageHeader
          icon="ListChecks"
          title="الجرد الدوري"
          subtitle="عدّ شريحة كل أسبوع بدل ما تقفل المخزن يوم كامل"
          backHref="/inventory"
        />

        {whList.length === 0 ? (
          <Card><CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">مفيش مستودعات مفعّلة.</p>
          </CardContent></Card>
        ) : (
          <CycleCountManager
            warehouses={whList.map((w) => ({ id: w.id, label: w.nameAr }))}
            canManage={can("inventory.create")}
            canPost={can("inventory.confirm")}
          />
        )}
      </div>
    );
  });
}
