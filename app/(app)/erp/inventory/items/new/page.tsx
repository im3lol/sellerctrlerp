import { requireErpModule } from "@/lib/erp/org";
import { ErpPageHeader } from "@/components/erp/page-header";
import { ItemForm } from "@/components/erp/item-form";

export default async function NewItemPage() {
  await requireErpModule("inventory.create");
  return (
    <div className="space-y-6">
      <ErpPageHeader icon="Package" title="صنف جديد" subtitle="أضف صنفاً باسمه ووصفه وأكواده وصورته" backHref="/erp/inventory/items" />
      <ItemForm />
    </div>
  );
}
