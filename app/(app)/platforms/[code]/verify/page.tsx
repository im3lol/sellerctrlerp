import { loadErpPage } from "@/lib/erp/org";
import { getT } from "@/lib/i18n/server";
import { ErpPageHeader } from "@/components/erp/page-header";
import { SkuLinker } from "@/components/erp/sku-linker";

export default async function VerifyPlatformLinksPage({ params }: { params: Promise<{ code: string }> }) {
  const t = await getT();
  const { code } = await params;
  return loadErpPage("inventory.create", async () => {
    return (
      <div className="space-y-6">
        <ErpPageHeader
          icon="Link"
          title={t("التحقق من ربط أمازون")}
          subtitle={t("قارن منتجات أمازون بأصنافك واربط الناقص قبل المزامنة")}
          backHref={`/platforms/${code}`}
        />
        <SkuLinker amazonCode={code} />
      </div>
    );
  });
}
