import { loadErpPage } from "@/lib/erp/org";
import { ErpPageHeader } from "@/components/erp/page-header";
import { SkuLinker } from "@/components/erp/sku-linker";

export default async function VerifyPlatformLinksPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return loadErpPage("inventory.create", async () => {
    return (
      <div className="space-y-6">
        <ErpPageHeader
          icon="Link"
          title="التحقق من ربط أمازون"
          subtitle="قارن منتجات أمازون بأصنافك واربط الناقص قبل المزامنة"
          backHref={`/platforms/${code}`}
        />
        <SkuLinker amazonCode={code} />
      </div>
    );
  });
}
