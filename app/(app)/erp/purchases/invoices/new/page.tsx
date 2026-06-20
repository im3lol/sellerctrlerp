import { asc, eq } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { suppliers, warehouses, items } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { PurchaseInvoiceForm } from "@/components/erp/purchase-invoice-form";

export default async function NewPurchaseInvoicePage() {
  const { orgId } = await requireErpModule("purchases.create");

  const [supRows, whRows, itemRows] = await Promise.all([
    db.select({ id: suppliers.id, nameAr: suppliers.nameAr }).from(suppliers)
      .where(eq(suppliers.organizationId, orgId)).orderBy(asc(suppliers.nameAr)),
    db.select({ id: warehouses.id, nameAr: warehouses.nameAr }).from(warehouses)
      .where(eq(warehouses.organizationId, orgId)).orderBy(asc(warehouses.nameAr)),
    db.select({ id: items.id, nameAr: items.nameAr, sellPrice: items.sellPrice }).from(items)
      .where(eq(items.organizationId, orgId)).orderBy(asc(items.nameAr)),
  ]);

  return (
    <div className="space-y-6">
      <ErpPageHeader icon="ReceiptText" title="فاتورة شراء جديدة" subtitle="أضف المورد والمستودع والبنود" />
      <PurchaseInvoiceForm suppliers={supRows} warehouses={whRows} items={itemRows} />
    </div>
  );
}
