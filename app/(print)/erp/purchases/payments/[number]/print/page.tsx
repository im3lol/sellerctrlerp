import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { paymentVouchers, paymentLines, suppliers, purchaseInvoices, accounts } from "@/db/schema";
import { fmt, dt, money, toArabicWords } from "@/lib/erp/print-format";
import { loadPrintHeader } from "@/lib/erp/print-org";
import { DocumentSheet } from "@/components/erp/print/document-sheet";

const METHOD: Record<string, string> = {
  CASH: "نقدًا", BANK: "تحويل بنكي", CHECK: "شيك", CARD: "بطاقة",
};

type Params = { params: Promise<{ number: string }> };

export default async function PrintPaymentVoucherPage({ params }: Params) {
  const raw = decodeURIComponent((await params).number);
  return loadErpPage("purchases.view", async ({ orgId }) => {
    const [pv] = await db
      .select()
      .from(paymentVouchers)
      .where(and(eq(paymentVouchers.number, raw), eq(paymentVouchers.organizationId, orgId)))
      .limit(1);
    if (!pv) notFound();

    const [{ org, currency }, supp, cashAcc, lines] = await Promise.all([
      loadPrintHeader(orgId),
      pv.supplierId
        ? db.select({ nameAr: suppliers.nameAr, phone: suppliers.phone, address: suppliers.address })
            .from(suppliers).where(eq(suppliers.id, pv.supplierId)).limit(1).then((r) => r[0])
        : undefined,
      pv.cashAccountId
        ? db.select({ nameAr: accounts.nameAr }).from(accounts)
            .where(eq(accounts.id, pv.cashAccountId)).limit(1).then((r) => r[0])
        : undefined,
      db
        .select({
          amount: paymentLines.amount,
          invNumber: purchaseInvoices.number,
          invDate: purchaseInvoices.date,
          invTotal: purchaseInvoices.totalAmount,
        })
        .from(paymentLines)
        .leftJoin(purchaseInvoices, eq(purchaseInvoices.id, paymentLines.purchaseInvoiceId))
        .where(eq(paymentLines.paymentVoucherId, pv.id)),
    ]);

    return (
      <DocumentSheet
        org={org}
        title="سند صرف"
        number={pv.number}
        backHref={`/purchases/payments/${encodeURIComponent(raw)}`}
        meta={[{ label: "التاريخ", value: dt(pv.date) }]}
        parties={[
          {
            label: "صُرف إلى",
            name: supp?.nameAr ?? "—",
            lines: [supp?.address, supp?.phone],
          },
          {
            label: "طريقة الصرف",
            name: METHOD[pv.paymentMethod] ?? pv.paymentMethod,
            lines: [cashAcc?.nameAr, pv.reference ? `المرجع: ${pv.reference}` : null],
          },
        ]}
        columns={lines.length > 0 ? [
          { label: "الفاتورة", width: "40%" },
          { label: "تاريخها", align: "center", width: "25%" },
          { label: "إجماليها", align: "end", width: "17%" },
          { label: "المسدَّد", align: "end", width: "18%" },
        ] : []}
        rows={lines.map((l) => [
          <span key="n" dir="ltr" style={{ textAlign: "start", display: "block" }}>{l.invNumber ?? "تحت الحساب"}</span>,
          l.invDate ? dt(l.invDate) : "—",
          l.invTotal ? fmt(l.invTotal) : "—",
          <b key="a">{fmt(l.amount)}</b>,
        ])}
        balance={{ label: "المبلغ المصروف", value: money(pv.amount, currency) }}
        // The wording that makes a signed voucher hard to alter afterwards.
        note={`فقط وقدره ${toArabicWords(Number(pv.amount))} لا غير.${pv.notes ? `\n${pv.notes}` : ""}`}
        signatures={["إعداد", "اعتماد", "المورّد / المستلم"]}
      />
    );
  });
}
