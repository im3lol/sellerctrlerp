import { notFound } from "next/navigation";
import { loadErpPage } from "@/lib/erp/org";
import { salesQuotations } from "@/db/schema";
import { quotationSheet } from "@/lib/erp/doc-sheets";
import { DocumentSheet } from "@/components/erp/print/document-sheet";
import { docNumberParam } from "@/lib/erp/doc-route";

type Params = { params: Promise<{ number: string }> };

export default async function PrintQuotationPage({ params }: Params) {
  const raw = (await params).number;
  return loadErpPage("sales.view", async ({ orgId }) => {
    const number = await docNumberParam(raw, orgId, salesQuotations,
      { id: salesQuotations.id, number: salesQuotations.number, organizationId: salesQuotations.organizationId },
      "/erp/sales/quotations", "/print");
    // The same sheet the customer link shows (lib/erp/doc-sheets.tsx).
    const r = await quotationSheet(orgId, { number });
    if (!r) notFound();
    return <DocumentSheet {...r.sheet} backHref={`/sales/quotations/${encodeURIComponent(r.doc.number)}`} />;
  });
}
