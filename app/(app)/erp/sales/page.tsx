import { asc, eq } from "drizzle-orm";
import { requireErpModule, erpCan } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { customers } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { CustomersManager } from "@/components/erp/customers-manager";

export default async function ErpSalesPage() {
  const { orgId, role } = await requireErpModule("sales.view");
  const rows = await db
    .select({
      id: customers.id,
      code: customers.code,
      nameAr: customers.nameAr,
      phone: customers.phone,
      email: customers.email,
      balance: customers.balance,
      creditLimit: customers.creditLimit,
      paymentTerms: customers.paymentTerms,
    })
    .from(customers)
    .where(eq(customers.organizationId, orgId))
    .orderBy(asc(customers.code));

  return (
    <div className="space-y-6">
      <ErpPageHeader icon="ShoppingCart" title="المبيعات — العملاء" subtitle={`${rows.length} عميل`} />
      <CustomersManager customers={rows} canManage={erpCan(role, "sales.edit")} />
    </div>
  );
}
