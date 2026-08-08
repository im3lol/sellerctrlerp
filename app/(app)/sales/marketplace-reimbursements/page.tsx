import { ErpPageHeader } from "@/components/erp/page-header";
import { loadErpPage } from "@/lib/erp/org";
import { getReimbursementsForReview } from "@/lib/erp/reimbursements-core";
import { MarketplaceReimbursementsClient } from "@/components/erp/marketplace-reimbursements-client";

export const dynamic = "force-dynamic";

// Marketplace reimbursements (Amazon paying back for lost/damaged/disposed stock) awaiting
// recognition. Confirming books a DRAFT journal entry (Dr wallet / Cr 4103) linked to the
// loss it compensates; the accountant reviews + posts.
export default async function MarketplaceReimbursementsPage() {
  return loadErpPage("accounting.view", async ({ orgId }) => {
    const rows = await getReimbursementsForReview(orgId);
    return (
      <div className="space-y-6">
        <ErpPageHeader
          icon="HandCoins"
          title="تعويضات المنصات"
          subtitle="تعويضات أمازون عن مخزون ضائع/تالف — أكّد لتسجيلها كإيراد آخر (4103) مربوط بالخسارة"
          backHref="/sales/marketplace-returns"
        />
        <MarketplaceReimbursementsClient initial={rows} />
      </div>
    );
  });
}
