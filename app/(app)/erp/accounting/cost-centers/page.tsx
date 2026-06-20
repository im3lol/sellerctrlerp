import { asc, eq } from "drizzle-orm";
import { requireErpModule, erpCan } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { costCenters } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { CostCentersTree } from "@/components/erp/cost-centers-tree";

export default async function CostCentersPage() {
  const { orgId, role } = await requireErpModule("accounting.view");
  const rows = await db
    .select({
      id: costCenters.id,
      code: costCenters.code,
      nameAr: costCenters.nameAr,
      nameEn: costCenters.nameEn,
      parentId: costCenters.parentId,
      isActive: costCenters.isActive,
    })
    .from(costCenters)
    .where(eq(costCenters.organizationId, orgId))
    .orderBy(asc(costCenters.code));

  return (
    <div className="space-y-6">
      <ErpPageHeader icon="Target" title="مراكز التكلفة" subtitle={`${rows.length} مركز`} />
      <CostCentersTree centers={rows} canManage={erpCan(role, "accounting.create")} />
    </div>
  );
}
