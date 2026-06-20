import { and, asc, eq } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { customers, items } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { SalesOrderForm } from "@/components/erp/sales-order-form";

export default async function NewSalesOrderPage() {
  const { orgId } = await requireErpModule("sales.view");
  const [custList, itemList] = await Promise.all([
    db.select({ id: customers.id, nameAr: customers.nameAr }).from(customers)
      .where(eq(customers.organizationId, orgId)).orderBy(asc(customers.code)),
    db.select({ id: items.id, nameAr: items.nameAr, sellPrice: items.sellPrice }).from(items)
      .where(and(eq(items.organizationId, orgId), eq(items.isActive, true))).orderBy(asc(items.code)),
  ]);

  return (
    <div className="space-y-6">
      <ErpPageHeader icon="ClipboardList" title="أمر بيع جديد" subtitle="التزام بيع — يُحوّل لفاتورة لاحقاً" backHref="/erp/sales/orders" />
      <SalesOrderForm customers={custList} items={itemList} />
    </div>
  );
}
