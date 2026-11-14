import { ErpPageHeader } from "@/components/erp/page-header";
import { getT } from "@/lib/i18n/server";
import { getReturnWorkspaceAction } from "@/app/actions/erp/return-workflow";
import { ReturnWorkspace } from "@/components/erp/return-workspace";
import {getMarketplaceReturns,getReturnWarehouses}from "@/app/actions/erp/platform-returns";
import {MarketplaceReturnsClient}from "@/components/erp/marketplace-returns-client";

export const dynamic = "force-dynamic";

// Financial, stock and claim evidence are approved independently.
export default async function MarketplaceReturnsPage() {
  const t = await getT();
  const data = await getReturnWorkspaceAction();
  if ("error" in data) return <p className="p-6 text-destructive">{data.error}</p>;
  const [legacy,warehouses]=await Promise.all([getMarketplaceReturns(),getReturnWarehouses()]);
  return (
    <div className="space-y-6">
      <ErpPageHeader
        icon="PackageX"
        title={t("المرتجعات والتعويضات")}
        subtitle={t("متابعة رد المبالغ والاستلام الفعلي والرسوم والتعويضات؛ كل مرحلة بدليل مستقل")}
        backHref="/sales/returns"
      />
      <ReturnWorkspace initial={data} />
      {(data.config.mode==="DISABLED"||legacy.some(r=>r.channel!=="AMAZON"))&&<MarketplaceReturnsClient initial={data.config.mode==="DISABLED"?legacy:legacy.filter(r=>r.channel!=="AMAZON")} warehouses={warehouses} />}
    </div>
  );
}
