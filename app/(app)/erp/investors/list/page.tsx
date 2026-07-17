import { asc, eq } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { investors } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { InvestorsManager } from "@/components/erp/investors-manager";

/** The investor master file. Moved off /erp/investors so that route can be the module. */
export default async function InvestorsListPage() {
  return loadErpPage("investors.view", async ({ orgId, can }) => {
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
        <ErpPageHeader icon="Coins" title="المستثمرون" subtitle={`${rows.length} مستثمر`} backHref="/erp/investors" />
        <InvestorsManager investors={rows} canManage={can("investors.edit")} />
      </div>
    );
  });
}
