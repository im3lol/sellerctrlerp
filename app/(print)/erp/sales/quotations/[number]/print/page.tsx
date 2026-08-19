import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { salesQuotations, salesQuotationLines, customers, items } from "@/db/schema";
import { fmt, qty, dt, money } from "@/lib/erp/print-format";
import { loadPrintHeader } from "@/lib/erp/print-org";
import { DocumentSheet } from "@/components/erp/print/document-sheet";
import { renderRichText } from "@/lib/erp/rich-text";
import { docNumberParam, docHref } from "@/lib/erp/doc-route";

const STATUS: Record<string, string> = {
  DRAFT: "مسودة", SENT: "مُرسل", ACCEPTED: "مقبول", REJECTED: "مرفوض",
};

type Params = { params: Promise<{ number: string }> };

export default async function PrintQuotationPage({ params }: Params) {
  const raw = (await params).number;
  return loadErpPage("sales.view", async ({ orgId }) => {
    const number = await docNumberParam(raw, orgId, salesQuotations,
      { id: salesQuotations.id, number: salesQuotations.number, organizationId: salesQuotations.organizationId },
      "/erp/sales/quotations", "/print");
    const [q] = await db
      .select()
      .from(salesQuotations)
      .where(and(eq(salesQuotations.number, number), eq(salesQuotations.organizationId, orgId)))
      .limit(1);
    if (!q) notFound();

    const [{ org, currency, hiddenFor, footerText }, cust, lines] = await Promise.all([
      loadPrintHeader(orgId),
      db.select({ nameAr: customers.nameAr, phone: customers.phone, address: customers.address })
        .from(customers).where(eq(customers.id, q.customerId)).limit(1).then((r) => r[0]),
      db
        .select({
          qty: salesQuotationLines.quantity,
          unitPrice: salesQuotationLines.unitPrice,
          discount: salesQuotationLines.discountAmount,
          tax: salesQuotationLines.taxAmount,
          code: items.code,
          name: items.nameAr,
          image: items.image,
        })
        .from(salesQuotationLines)
        .leftJoin(items, eq(items.id, salesQuotationLines.itemId))
        .where(eq(salesQuotationLines.quotationId, q.id)),
    ]);

    // No stored totals on a quotation — the header carries no total column, so the figures
    // are derived from the lines here. The whole-quote discount is the one exception:
    // it is an input, not a derivation, so it comes off the header.
    const lineNet = (l: (typeof lines)[number]) =>
      Number(l.qty ?? 0) * Number(l.unitPrice ?? 0) - Number(l.discount ?? 0);
    const subtotal = lines.reduce((s, l) => s + Number(l.qty ?? 0) * Number(l.unitPrice ?? 0), 0);
    const discount = lines.reduce((s, l) => s + Number(l.discount ?? 0), 0);
    const tax = lines.reduce((s, l) => s + Number(l.tax ?? 0), 0);
    const headerDiscount = Number(q.discountAmount ?? 0);
    // Clamped: a discount larger than the bill must not print a negative total.
    const total = Math.max(0, subtotal - discount + tax - headerDiscount);

    return (
      <DocumentSheet
        org={org}
        hiddenColumns={hiddenFor("sales-quotation")}
        footerText={footerText}
        title="عرض سعر"
        number={q.number}
        watermark={q.status === "DRAFT" ? "مسودة" : undefined}
        backHref={docHref("/sales/quotations", q.number)}
        meta={[
          { label: "التاريخ", value: dt(q.date) },
          ...(q.validUntil ? [{ label: "ساري حتى", value: dt(q.validUntil) }] : []),
          { label: "الحالة", value: STATUS[q.status] ?? q.status },
        ]}
        parties={cust ? [{
          label: "عرض إلى",
          name: cust.nameAr,
          lines: [cust.address, cust.phone],
        }] : []}
        columns={[
          { label: "#", width: "4%" },
          // A normal print column, so it can be switched off in the org's print settings.
          { label: "صورة", align: "center", width: "9%" },
          { label: "الصنف", width: "37%" },
          { label: "الكمية", align: "center", width: "10%" },
          { label: "السعر", align: "end", width: "14%" },
          { label: "الخصم", align: "end", width: "11%" },
          { label: "الإجمالي", align: "end", width: "15%" },
        ]}
        rows={lines.map((l, i) => [
          <span key="i" style={{ color: "#8a93a6" }}>{i + 1}</span>,
          // Real <img> (print drops CSS backgrounds, not images), fixed box so a tall
          // picture cannot stretch the row, and nothing when the item has no image.
          // Not lazy: a lazy image can still be unloaded when the print dialog fires.
          <span key="img" style={{ display: "inline-block", width: 36, height: 36, verticalAlign: "middle" }}>
            {l.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={l.image} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
            ) : null}
          </span>,
          <span key="n">
            <b>{l.name}</b>
            {l.code && <span dir="ltr" style={{ color: "#8a93a6", fontSize: 10.5, marginInlineStart: 6 }}>{l.code}</span>}
          </span>,
          qty(l.qty),
          fmt(l.unitPrice),
          Number(l.discount ?? 0) > 0 ? fmt(l.discount) : "—",
          <b key="t">{fmt(lineNet(l))}</b>,
        ])}
        totals={[
          { label: "الإجمالي الفرعي", value: money(subtotal, currency) },
          ...(discount > 0 ? [{ label: "الخصم", value: `− ${money(discount, currency)}`, tone: "danger" as const }] : []),
          ...(tax > 0 ? [{ label: "الضريبة", value: money(tax, currency) }] : []),
          ...(headerDiscount > 0 ? [{ label: "خصم على الإجمالي", value: `− ${money(headerDiscount, currency)}`, tone: "danger" as const }] : []),
        ]}
        balance={{ label: "الإجمالي", value: money(total, currency) }}
        note={renderRichText(q.notes) ?? (q.validUntil ? `هذا العرض ساري حتى ${dt(q.validUntil)}.` : null)}
        signatures={["إعداد", "اعتماد"]}
      />
    );
  });
}
