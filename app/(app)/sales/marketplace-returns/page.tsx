import { ErpPageHeader } from "@/components/erp/page-header";
import { getMarketplaceReturns } from "@/app/actions/erp/platform-returns";
import { MarketplaceReturnsClient } from "@/components/erp/marketplace-returns-client";

export const dynamic = "force-dynamic";

// Marketplace customer returns awaiting the trader's receipt decision. Each is a DRAFT
// credit note (from the FBA sync or CSV import); confirming with a receipt choice posts
// the invoice reversal and — only when the goods were actually received — the restock.
export default async function MarketplaceReturnsPage() {
  const rows = await getMarketplaceReturns();
  return (
    <div className="space-y-6">
      <ErpPageHeader
        icon="PackageX"
        title="مرتجعات المنصات"
        subtitle="مرتجعات العملاء من أمازون/نون كمسودّات — أكّد الاستلام ليترحّل على الفاتورة والمخزون والطلب"
        backHref="/sales/returns"
      />
      <MarketplaceReturnsClient initial={rows} />
    </div>
  );
}
