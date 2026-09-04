import { and, asc, eq } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { items, suppliers, warehouses } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { RfqManager } from "@/components/erp/rfq-manager";

export default async function RfqsPage() {
  return loadErpPage("purchases.view", async ({ orgId, can }) => {
    const [itemList, supList, whList] = await Promise.all([
      db.select({ id: items.id, code: items.code, nameAr: items.nameAr })
        .from(items).where(and(eq(items.organizationId, orgId), eq(items.isActive, true)))
        .orderBy(asc(items.code)).limit(2000),
      db.select({ id: suppliers.id, code: suppliers.code, nameAr: suppliers.nameAr })
        .from(suppliers).where(and(eq(suppliers.organizationId, orgId), eq(suppliers.isActive, true)))
        .orderBy(asc(suppliers.code)),
      db.select({ id: warehouses.id, nameAr: warehouses.nameAr })
        .from(warehouses).where(and(eq(warehouses.organizationId, orgId), eq(warehouses.isActive, true)))
        .orderBy(asc(warehouses.nameAr)),
    ]);

    return (
      <div className="space-y-6">
        <ErpPageHeader
          icon="GitCompare"
          title="طلبات عروض الأسعار"
          subtitle="نفس السلة لكذا مورّد، وجدول واحد يقارن ردودهم"
          backHref="/purchases"
        />
        <RfqManager
          canManage={can("purchases.create")}
          items={itemList.map((i) => ({ id: i.id, label: `${i.code} — ${i.nameAr ?? ""}` }))}
          suppliers={supList.map((s) => ({ id: s.id, label: `${s.code} — ${s.nameAr}` }))}
          warehouses={whList.map((w) => ({ id: w.id, label: w.nameAr }))}
        />
      </div>
    );
  });
}
