import { and, asc, eq } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { items, warehouses } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { TransferForm } from "@/components/erp/transfer-form";

export default async function NewTransferPage() {
  const { orgId } = await requireErpModule("inventory.create");

  const [itemList, whList] = await Promise.all([
    db.select({ id: items.id, code: items.code, name: items.nameAr }).from(items)
      .where(and(eq(items.organizationId, orgId), eq(items.isActive, true))).orderBy(asc(items.code)),
    db.select({ id: warehouses.id, code: warehouses.code, name: warehouses.nameAr }).from(warehouses)
      .where(and(eq(warehouses.organizationId, orgId), eq(warehouses.isActive, true))).orderBy(asc(warehouses.code)),
  ]);

  return (
    <div className="space-y-6">
      <ErpPageHeader icon="ArrowLeftRight" title="تحويل مخزني جديد" subtitle="نقل بين المستودعات" backHref="/erp/inventory/transfers" />
      <TransferForm
        items={itemList.map((i) => ({ id: i.id, code: i.code, name: i.name ?? "" }))}
        warehouses={whList.map((w) => ({ id: w.id, code: w.code, name: w.name }))}
      />
    </div>
  );
}
