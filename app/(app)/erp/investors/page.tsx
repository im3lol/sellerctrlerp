import { asc, eq } from "drizzle-orm";
import { requireErpModule, erpCan } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { investors } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { InvestorsManager } from "@/components/erp/investors-manager";

export default async function ErpInvestorsPage() {
  const { orgId, role } = await requireErpModule("investors.view");
  const rows = await db
    .select({
      id: investors.id,
      code: investors.code,
      fullName: investors.fullName,
      phone: investors.phone,
      email: investors.email,
      nationalId: investors.nationalId,
      status: investors.status,
    })
    .from(investors)
    .where(eq(investors.organizationId, orgId))
    .orderBy(asc(investors.code));

  return (
    <div className="space-y-6">
      <ErpPageHeader icon="Coins" title="المستثمرون" subtitle={`${rows.length} مستثمر`} />
      <InvestorsManager investors={rows} canManage={erpCan(role, "investors.edit")} />
    </div>
  );
}
