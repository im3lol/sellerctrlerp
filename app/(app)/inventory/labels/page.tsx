import { loadErpPage } from "@/lib/erp/org";
import { getT } from "@/lib/i18n/server";
import { ErpPageHeader } from "@/components/erp/page-header";
import { BarcodeLabelsPicker } from "@/components/erp/barcode-labels-picker";

export default async function BarcodeLabelsPage() {
  const t = await getT();
  return loadErpPage("inventory.view", async () => {
    return (
      <div className="space-y-6">
        <ErpPageHeader icon="Barcode" title={t("طباعة ملصقات الباركود")} subtitle={t("اختر أصنافاً وعدد الملصقات لطباعتها دفعة واحدة")} backHref="/inventory" />
        <BarcodeLabelsPicker />
      </div>
    );
  });
}
