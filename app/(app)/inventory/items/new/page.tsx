import { loadErpPage } from "@/lib/erp/org";
import { getT } from "@/lib/i18n/server";
import { ErpPageHeader } from "@/components/erp/page-header";
import { ItemForm } from "@/components/erp/item-form";

export default async function NewItemPage() {
  const t = await getT();
  return loadErpPage("inventory.create", async () => {
    return (
      <div className="space-y-6">
        <ErpPageHeader icon="Package" title={t("صنف جديد")} subtitle={t("أضف صنفاً باسمه ووصفه وأكواده وصورته")} backHref="/inventory/items" />
        <ItemForm />
      </div>
    );
  });
}
