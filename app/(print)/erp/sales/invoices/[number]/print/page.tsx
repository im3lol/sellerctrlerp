import { notFound } from "next/navigation";
import { loadErpPage } from "@/lib/erp/org";
import { invoiceSheet } from "@/lib/erp/doc-sheets";
import { DocumentSheet } from "@/components/erp/print/document-sheet";

type Params = { params: Promise<{ number: string }> };

export default async function PrintSalesInvoicePage({ params }: Params) {
  const raw = decodeURIComponent((await params).number);
  return loadErpPage("sales.view", async ({ orgId }) => {
    // The same sheet the customer link shows (lib/erp/doc-sheets.tsx).
    const r = await invoiceSheet(orgId, { number: raw });
    if (!r) notFound();
    return <DocumentSheet {...r.sheet} backHref={`/sales/invoices/${encodeURIComponent(raw)}`} />;
  });
}
