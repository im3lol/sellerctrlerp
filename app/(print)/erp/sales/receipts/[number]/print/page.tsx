import { notFound } from "next/navigation";
import { fill } from "@/lib/i18n";
import { getLocale, getT } from "@/lib/i18n/server";
import { and, eq } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { receiptVouchers, receiptLines, customers, salesInvoices } from "@/db/schema";
import { fmt, dt, money, amountInWords } from "@/lib/erp/print-format";
import { loadPrintHeader } from "@/lib/erp/print-org";
import { DocumentSheet } from "@/components/erp/print/document-sheet";

const METHODS: Record<string, string> = {
  CASH: "نقدًا", BANK_TRANSFER: "تحويل بنكي", CHECK: "شيك", CREDIT_CARD: "بطاقة ائتمان",
};

type Params = { params: Promise<{ number: string }> };

export default async function PrintReceiptVoucherPage({ params }: Params) {
  const t = await getT();
  const locale = await getLocale();
  const raw = decodeURIComponent((await params).number);
  return loadErpPage("sales.view", async ({ orgId }) => {
    const [rv] = await db
      .select()
      .from(receiptVouchers)
      .where(and(eq(receiptVouchers.number, raw), eq(receiptVouchers.organizationId, orgId)))
      .limit(1);
    if (!rv) notFound();

    const [{ org, currency, footerText }, cust, lines] = await Promise.all([
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
        footerText={footerText}
        title={t("سند قبض")}
        number={rv.number}
        backHref={`/sales/receipts/${encodeURIComponent(raw)}`}
        meta={[{ label: "التاريخ", value: dt(rv.date, locale) }]}
        parties={[
          {
            label: "استُلم من",
            name: cust?.nameAr ?? "—",
            lines: [cust?.phone],
          },
          {
            label: "طريقة السداد",
            name: t(METHODS[rv.paymentMethod] ?? rv.paymentMethod),
            lines: [rv.reference ? fill(t("المرجع: {0}"), [rv.reference]) : null],
          },
        ]}
        columns={lines.length > 0 ? [
          { label: "الفاتورة", width: "60%" },
          { label: "المبلغ", align: "end", width: "40%" },
        ] : []}
        rows={lines.map((l) => [
          <span key="n" dir="ltr" style={{ textAlign: "start", display: "block" }}>{l.invoiceNumber ?? t("تحت الحساب")}</span>,
          fmt(l.amount),
        ])}
        // The amount received IS the document — it gets the highlight, not a total row.
        balance={{ label: "المبلغ المستلم", value: money(rv.amount, currency, locale) }}
        // Same «فقط وقدره» line the payment voucher already had — both are vouchers
        // someone signs, and only one of them said the amount in words.
        note={`${amountInWords(Number(rv.amount), locale)}.${rv.notes ? `\n${rv.notes}` : ""}`}
        signatures={["التوقيع", "المستلم", "المحاسب"]}
      />
    );
  });
}
