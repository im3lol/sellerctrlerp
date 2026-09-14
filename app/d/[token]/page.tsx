import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { withOrgScope } from "@/lib/db-scope";
import { verifyDocLink, docLinkSecret } from "@/lib/erp/doc-link";
import { invoiceSheet, quotationSheet } from "@/lib/erp/doc-sheets";
import { DocumentSheet } from "@/components/erp/print/document-sheet";
import { QuoteResponse } from "@/components/public/quote-response";

export const dynamic = "force-dynamic";
// A customer's document — never in a search index, never followed.
export const metadata: Metadata = { title: "مستند", robots: { index: false, follow: false } };

const box = "no-print mx-auto my-6 max-w-[210mm] rounded-xl border bg-white p-5 text-sm shadow-sm";

/**
 * The customer link: a quotation or an invoice, opened without an account. The signed
 * token is the whole authorisation — it names the org and the document, and it expires.
 */
export default async function CustomerDocPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const link = verifyDocLink(docLinkSecret(), token);
  if (!link) {
    return (
      <div dir="rtl" className="flex min-h-screen items-center justify-center p-6 text-center">
        <div className="max-w-sm space-y-2">
          <h1 className="text-lg font-bold">الرابط انتهى أو مش صحيح</h1>
          <p className="text-sm text-muted-foreground">اطلب من الشركة رابط جديد.</p>
        </div>
      </div>
    );
  }

  return withOrgScope(link.o, false, async () => {
    if (link.k === "SI") {
      const r = await invoiceSheet(link.o, { id: link.id });
      // A draft or a cancelled invoice isn't the customer's to see.
      if (!r || r.doc.status === "DRAFT" || r.doc.status === "CANCELLED") notFound();
      const org = r.sheet.org;
      return (
        <div dir="rtl">
          <DocumentSheet {...r.sheet} />
          {r.doc.balanceDue > 0 && (
            <div className={box}>
              <div className="font-bold">المتبقّي عليك: {r.doc.balanceText}</div>
              {/* ponytail: the online-pay button goes here once a payment provider is linked
                  (the owner hasn't picked one yet); until then, how to pay the company. */}
              <p className="mt-1 text-muted-foreground">
                للدفع أو لأي استفسار تواصل مع {org?.nameAr ?? "الشركة"}{org?.phone ? ` على ${org.phone}` : ""}.
              </p>
            </div>
          )}
        </div>
      );
    }

    const r = await quotationSheet(link.o, { id: link.id });
    if (!r) notFound();
    return (
      <div dir="rtl">
        <DocumentSheet {...r.sheet} />
        <div className={box}><QuoteResponse token={token} status={r.doc.status} /></div>
      </div>
    );
  });
}
