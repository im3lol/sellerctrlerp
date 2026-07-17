import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { receiptVouchers, receiptLines, customers, salesInvoices } from "@/db/schema";
import { fmt, dt, money, toArabicWords } from "@/lib/erp/print-format";
import { loadPrintHeader } from "@/lib/erp/print-org";
import { DocumentSheet } from "@/components/erp/print/document-sheet";

const METHODS: Record<string, string> = {
  CASH: "نقدًا", BANK_TRANSFER: "تحويل بنكي", CHECK: "شيك", CREDIT_CARD: "بطاقة ائتمان",
};

type Params = { params: Promise<{ number: string }> };

export default async function PrintReceiptVoucherPage({ params }: Params) {
  const raw = decodeURIComponent((await params).number);
  const { orgId } = await requireErpModule("sales.view");

  const [rv] = await db
    .select()
    .from(receiptVouchers)
    .where(and(eq(receiptVouchers.number, raw), eq(receiptVouchers.organizationId, orgId)))
    .limit(1);
  if (!rv) notFound();

  const [{ org, currency }, cust, lines] = await Promise.all([
    loadPrintHeader(orgId),
    rv.customerId
      ? db.select({ nameAr: customers.nameAr, phone: customers.phone })
          .from(customers).where(eq(customers.id, rv.customerId)).limit(1).then((r) => r[0])
      : undefined,
    db
      .select({ amount: receiptLines.amount, invoiceNumber: salesInvoices.number })
      .from(receiptLines)
      .leftJoin(salesInvoices, eq(salesInvoices.id, receiptLines.salesInvoiceId))
      .where(eq(receiptLines.receiptVoucherId, rv.id)),
  ]);

  return (
    <DocumentSheet
      org={org}
      title="سند قبض"
      number={rv.number}
      backHref={`/erp/sales/receipts/${encodeURIComponent(raw)}`}
      meta={[{ label: "التاريخ", value: dt(rv.date) }]}
      parties={[
        {
          label: "استُلم من",
          name: cust?.nameAr ?? "—",
          lines: [cust?.phone],
        },
        {
          label: "طريقة السداد",
          name: METHODS[rv.paymentMethod] ?? rv.paymentMethod,
          lines: [rv.reference ? `المرجع: ${rv.reference}` : null],
        },
      ]}
      columns={lines.length > 0 ? [
        { label: "الفاتورة", width: "60%" },
        { label: "المبلغ", align: "end", width: "40%" },
      ] : []}
      rows={lines.map((l) => [
        <span key="n" dir="ltr" style={{ textAlign: "start", display: "block" }}>{l.invoiceNumber ?? "تحت الحساب"}</span>,
        fmt(l.amount),
      ])}
      // The amount received IS the document — it gets the highlight, not a total row.
      balance={{ label: "المبلغ المستلم", value: money(rv.amount, currency) }}
      // Same «فقط وقدره» line the payment voucher already had — both are vouchers
      // someone signs, and only one of them said the amount in words.
      note={`فقط وقدره ${toArabicWords(Number(rv.amount))} لا غير.${rv.notes ? `\n${rv.notes}` : ""}`}
      signatures={["التوقيع", "المستلم", "المحاسب"]}
    />
  );
}
