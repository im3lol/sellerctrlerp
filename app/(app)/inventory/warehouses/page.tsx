import { asc, eq } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { warehouses } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { WarehousesTree } from "@/components/erp/warehouses-tree";

export default async function WarehousesPage() {
  return loadErpPage("inventory.view", async ({ orgId, can }) => {
    const rows = await db
      .select({
        id: warehouses.id, code: warehouses.code, nameAr: warehouses.nameAr, type: warehouses.type,
        parentId: warehouses.parentId, location: warehouses.location, manager: warehouses.manager, isActive: warehouses.isActive,
      })
      .from(warehouses)
      .where(eq(warehouses.organizationId, orgId))
      .orderBy(asc(warehouses.code));

    return (
      <div className="space-y-6">
        <ErpPageHeader icon="Warehouse" title="المخازن" subtitle="المخازن ومواقعها الفرعية (منطقة/رف/صندوق)" backHref="/inventory" />
        <WarehousesTree warehouses={rows} canManage={can("inventory.create")} />
      </div>
    );
  });
}
