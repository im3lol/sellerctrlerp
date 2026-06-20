import { asc, eq } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { customers, items } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { InvoiceForm } from "@/components/erp/invoice-form";

export default async function NewSalesInvoicePage() {
  const { orgId } = await requireErpModule("sales.create");

  const [custRows, itemRows] = await Promise.all([
    db.select({ id: customers.id, nameAr: customers.nameAr }).from(customers)
      .where(eq(customers.organizationId, orgId)).orderBy(asc(customers.nameAr)),
    db.select({ id: items.id, nameAr: items.nameAr, sellPrice: items.sellPrice }).from(items)
      .where(eq(items.organizationId, orgId)).orderBy(asc(items.nameAr)),
  ]);

  return (
    <div className="space-y-6">
      <ErpPageHeader icon="ReceiptText" title="فاتورة بيع جديدة" subtitle="أضف العميل والبنود" />
      <InvoiceForm customers={custRows} items={itemRows} />
    </div>
  );
}
