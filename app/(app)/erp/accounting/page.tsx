import { asc, eq } from "drizzle-orm";
import { requireErpModule, erpCan } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { accounts } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { AccountsTree } from "@/components/erp/accounts-tree";

export default async function ErpAccountingPage() {
  const { orgId, role } = await requireErpModule("accounting.view");
  const rows = await db
    .select({
      id: accounts.id,
      code: accounts.code,
      nameAr: accounts.nameAr,
      nameEn: accounts.nameEn,
      type: accounts.type,
      normalBalance: accounts.normalBalance,
      parentId: accounts.parentId,
      isLeaf: accounts.isLeaf,
      isActive: accounts.isActive,
    })
    .from(accounts)
    .where(eq(accounts.organizationId, orgId))
    .orderBy(asc(accounts.code));

  const leafCount = rows.filter((r) => r.isLeaf).length;

  return (
    <div className="space-y-6">
      <ErpPageHeader icon="Calculator" title="المحاسبة — شجرة الحسابات" subtitle={`${rows.length} حساب (${leafCount} تفصيلي)`} />
      <AccountsTree accounts={rows} canManage={erpCan(role, "accounting.create")} />
    </div>
  );
}
