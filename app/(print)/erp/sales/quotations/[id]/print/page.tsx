import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { salesQuotations, salesQuotationLines, customers, items } from "@/db/schema";
import { fmt, qty, dt, money } from "@/lib/erp/print-format";
import { loadPrintHeader } from "@/lib/erp/print-org";
import { DocumentSheet } from "@/components/erp/print/document-sheet";

const STATUS: Record<string, string> = {
  DRAFT: "مسودة", SENT: "مُرسل", ACCEPTED: "مقبول", REJECTED: "مرفوض",
};

// Quotations are the only document keyed by UUID rather than a document number —
// they have no /[number] route, so the print route follows the detail page's [id].
type Params = { params: Promise<{ id: string }> };

export default async function PrintQuotationPage({ params }: Params) {
  const { id } = await params;
  const { orgId } = await requireErpModule("sales.view");

  const [q] = await db
    .select()
    .from(salesQuotations)
    .where(and(eq(salesQuotations.id, id), eq(salesQuotations.organizationId, orgId)))
    .limit(1);
  if (!q) notFound();

  const [{ org, currency }, cust, lines] = await Promise.all([
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
      })
      .from(salesQuotationLines)
      .leftJoin(items, eq(items.id, salesQuotationLines.itemId))
      .where(eq(salesQuotationLines.quotationId, q.id)),
  ]);

  // No stored totals on a quotation — the header has no total column, so the figures
  // are derived from the lines here.
  const lineNet = (l: (typeof lines)[number]) =>
    Number(l.qty ?? 0) * Number(l.unitPrice ?? 0) - Number(l.discount ?? 0);
  const subtotal = lines.reduce((s, l) => s + Number(l.qty ?? 0) * Number(l.unitPrice ?? 0), 0);
  const discount = lines.reduce((s, l) => s + Number(l.discount ?? 0), 0);
  const tax = lines.reduce((s, l) => s + Number(l.tax ?? 0), 0);
  const total = subtotal - discount + tax;

  return (
    <DocumentSheet
      org={org}
      title="عرض سعر"
      number={q.number}
      backHref={`/erp/sales/quotations/${q.id}`}
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
        { label: "#", width: "5%" },
        { label: "الصنف", width: "45%" },
        { label: "الكمية", align: "center", width: "10%" },
        { label: "السعر", align: "end", width: "14%" },
        { label: "الخصم", align: "end", width: "11%" },
        { label: "الإجمالي", align: "end", width: "15%" },
      ]}
      rows={lines.map((l, i) => [
        <span key="i" style={{ color: "#8a93a6" }}>{i + 1}</span>,
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
      ]}
      balance={{ label: "الإجمالي", value: money(total, currency) }}
      note={q.notes ?? (q.validUntil ? `هذا العرض ساري حتى ${dt(q.validUntil)}.` : null)}
      signatures={["إعداد", "اعتماد"]}
    />
  );
}
