import { loadErpPage } from "@/lib/erp/org";
import { ErpPageHeader } from "@/components/erp/page-header";
import { SkuLinker } from "@/components/erp/sku-linker";

export default async function LinkAmazonCodesPage() {
  return loadErpPage("inventory.create", async () => {
    return (
      <div className="space-y-6">
        <ErpPageHeader
          icon="Link"
          title="ربط أكواد أمازون"
          subtitle="ربط أكواد SKU/ASIN بالأصناف دفعة واحدة"
          backHref="/erp/sales/orders/import"
        />
        <SkuLinker />
      </div>
    );
  });
}
