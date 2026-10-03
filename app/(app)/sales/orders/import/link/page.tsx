import { loadErpPage } from "@/lib/erp/org";
import { getT } from "@/lib/i18n/server";
import { ErpPageHeader } from "@/components/erp/page-header";
import { SkuLinker } from "@/components/erp/sku-linker";

export default async function LinkAmazonCodesPage() {
  const t = await getT();
  return loadErpPage("inventory.create", async () => {
    return (
      <div className="space-y-6">
        <ErpPageHeader
          icon="Link"
          title={t("ربط أكواد أمازون")}
          subtitle={t("ربط أكواد SKU/ASIN بالأصناف دفعة واحدة")}
          backHref="/sales/orders/import"
        />
        <SkuLinker />
      </div>
    );
  });
}
