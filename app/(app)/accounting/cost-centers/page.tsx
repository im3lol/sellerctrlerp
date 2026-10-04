import { asc, eq } from "drizzle-orm";
import { fill } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { costCenters } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { CostCentersTree } from "@/components/erp/cost-centers-tree";

export default async function CostCentersPage() {
  const t = await getT();
  return loadErpPage("accounting.view", async ({ orgId, can }) => {
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
        <ErpPageHeader icon="Target" title={t("مراكز التكلفة")} subtitle={fill(t("{0} مركز"), [rows.length])} />
        <CostCentersTree centers={rows} canManage={can("accounting.create")} />
      </div>
    );
  });
}
