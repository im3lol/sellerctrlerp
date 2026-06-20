import { and, asc, eq } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { suppliers, warehouses, items } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { PurchaseOrderForm } from "@/components/erp/purchase-order-form";

export default async function NewPurchaseOrderPage() {
  const { orgId } = await requireErpModule("purchases.view");
  const [supList, whList, itemList] = await Promise.all([
    db.select({ id: suppliers.id, nameAr: suppliers.nameAr }).from(suppliers)
      .where(eq(suppliers.organizationId, orgId)).orderBy(asc(suppliers.code)),
    db.select({ id: warehouses.id, nameAr: warehouses.nameAr }).from(warehouses)
      .where(and(eq(warehouses.organizationId, orgId), eq(warehouses.isActive, true))).orderBy(asc(warehouses.code)),
    db.select({ id: items.id, nameAr: items.nameAr }).from(items)
      .where(and(eq(items.organizationId, orgId), eq(items.isActive, true))).orderBy(asc(items.code)),
  ]);

  return (
    <div className="space-y-6">
      <ErpPageHeader icon="ClipboardList" title="أمر شراء جديد" subtitle="التزام شراء — يُحوّل لفاتورة لاحقاً" backHref="/erp/purchases/orders" />
      <PurchaseOrderForm suppliers={supList} warehouses={whList} items={itemList} />
    </div>
  );
}
