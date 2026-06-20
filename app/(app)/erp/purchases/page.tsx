import { asc, eq } from "drizzle-orm";
import { requireErpModule, erpCan } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { suppliers } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { SuppliersManager } from "@/components/erp/suppliers-manager";

export default async function ErpPurchasesPage() {
  const { orgId, role } = await requireErpModule("purchases.view");
  const rows = await db
    .select({
      id: suppliers.id,
      code: suppliers.code,
      nameAr: suppliers.nameAr,
      phone: suppliers.phone,
      balance: suppliers.balance,
      paymentTerms: suppliers.paymentTerms,
    })
    .from(suppliers)
    .where(eq(suppliers.organizationId, orgId))
    .orderBy(asc(suppliers.code));

  return (
    <div className="space-y-6">
      <ErpPageHeader icon="Truck" title="المشتريات — الموردون" subtitle={`${rows.length} مورد`} />
      <SuppliersManager suppliers={rows} canManage={erpCan(role, "purchases.edit")} />
    </div>
  );
}
