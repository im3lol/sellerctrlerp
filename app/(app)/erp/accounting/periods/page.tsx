import { desc, eq } from "drizzle-orm";
import { requireErpModule, erpCan } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { fiscalPeriods } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { PeriodsManager } from "@/components/erp/periods-manager";

export default async function PeriodsPage() {
  const { orgId, role } = await requireErpModule("accounting.view");
  const rows = await db
    .select({
      id: fiscalPeriods.id,
      name: fiscalPeriods.name,
      startDate: fiscalPeriods.startDate,
      endDate: fiscalPeriods.endDate,
      status: fiscalPeriods.status,
    })
    .from(fiscalPeriods)
    .where(eq(fiscalPeriods.organizationId, orgId))
    .orderBy(desc(fiscalPeriods.startDate));

  return (
    <div className="space-y-6">
      <ErpPageHeader icon="Lock" title="إقفال الفترات المالية" subtitle={`${rows.length} فترة`} />
      <PeriodsManager periods={rows} canManage={erpCan(role, "accounting.create")} />
    </div>
  );
}
