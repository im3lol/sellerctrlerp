import { asc, eq } from "drizzle-orm";
import { requireErpModule, erpCan } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { items } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { ItemsManager } from "@/components/erp/items-manager";

export default async function ErpInventoryPage() {
  const { orgId, role } = await requireErpModule("inventory.view");
  const rows = await db
    .select({
      id: items.id,
      code: items.code,
      nameAr: items.nameAr,
      sellPrice: items.sellPrice,
      minStock: items.minStock,
      isActive: items.isActive,
    })
    .from(items)
    .where(eq(items.organizationId, orgId))
    .orderBy(asc(items.code));

  return (
    <div className="space-y-6">
      <ErpPageHeader icon="Warehouse" title="المخزون — الأصناف" subtitle={`${rows.length} صنف`} />
      <ItemsManager items={rows} canManage={erpCan(role, "inventory.edit")} />
    </div>
  );
}
