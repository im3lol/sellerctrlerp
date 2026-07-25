import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { receiptVouchers, customers, salesInvoices, accounts } from "@/db/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ErpPageHeader } from "@/components/erp/page-header";
import { VoucherDetailActions } from "@/components/erp/voucher-detail-actions";
import { Field, DocAuditCard, UUID_RE } from "@/components/erp/document-detail";
import { getDocumentAudit } from "@/lib/erp/audit";

const fmt = (v: string | number | null) => Number(v ?? 0).toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dt = (d: Date) => new Date(d).toLocaleDateString("en-GB", { year: "numeric", month: "2-digit", day: "2-digit" });
const METHOD: Record<string, string> = { CASH: "نقدي", BANK: "تحويل بنكي", CARD: "بطاقة", CHEQUE: "شيك" };
const STATUS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" }> = {
  DRAFT: { label: "مسودة", variant: "secondary" },
  POSTED: { label: "مرحّل", variant: "default" },
  REVERSED: { label: "معكوس", variant: "destructive" },
};

export default async function ReceiptVoucherDetailPage({ params }: { params: Promise<{ number: string }> }) {
  const raw = decodeURIComponent((await params).number);
  return loadErpPage("sales.view", async ({ orgId, can }) => {
    if (UUID_RE.test(raw)) {
      const [byId] = await db.select({ number: receiptVouchers.number }).from(receiptVouchers)
        .where(and(eq(receiptVouchers.id, raw), eq(receiptVouchers.organizationId, orgId))).limit(1);
      if (!byId) notFound();
      redirect(`/sales/receipts/${encodeURIComponent(byId.number)}`);
    }

    const [rv] = await db.select().from(receiptVouchers)
      .where(and(eq(receiptVouchers.number, raw), eq(receiptVouchers.organizationId, orgId))).limit(1);
    if (!rv) notFound();

    const [[cust], [inv], [acc], audit] = await Promise.all([
      db.select({ name: customers.nameAr }).from(customers).where(eq(customers.id, rv.customerId)).limit(1),
      rv.salesInvoiceId
        ? db.select({ number: salesInvoices.number }).from(salesInvoices).where(eq(salesInvoices.id, rv.salesInvoiceId)).limit(1)
        : Promise.resolve([] as { number: string }[]),
      rv.cashAccountId
        ? db.select({ code: accounts.code, name: accounts.nameAr }).from(accounts).where(eq(accounts.id, rv.cashAccountId)).limit(1)
        : Promise.resolve([] as { code: string; name: string }[]),
      getDocumentAudit(orgId, rv.id),
    ]);

    const st = STATUS[rv.status] ?? { label: rv.status, variant: "secondary" as const };

    return (
      <div className="space-y-6">
        <ErpPageHeader
          icon="HandCoins"
          title={`سند قبض ${rv.number}`}
          subtitle={`${cust?.name ?? "—"} · ${dt(rv.date)}`}
          backHref="/sales/receipts"
          action={<div className="flex items-center gap-3"><Badge variant={st.variant}>{st.label}</Badge><VoucherDetailActions id={rv.id} number={rv.number} type="receipt" status={rv.status} canManage={can("sales.collect")} /></div>}
        />

        <Card>
          <CardHeader><CardTitle>بيانات السند</CardTitle></CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="العميل">{cust?.name ?? "—"}</Field>
              <Field label="المبلغ"><span className="tabular-nums">{fmt(rv.amount)}</span></Field>
              <Field label="طريقة السداد">{METHOD[rv.paymentMethod] ?? rv.paymentMethod}</Field>
              <Field label="التاريخ">{dt(rv.date)}</Field>
              <Field label="حساب النقدية/البنك">{acc ? `${acc.code} — ${acc.name}` : "—"}</Field>
              <Field label="الفاتورة">{inv?.number ?? "تحت الحساب"}</Field>
              {rv.reference && <Field label="المرجع">{rv.reference}</Field>}
              {rv.notes && <Field label="ملاحظات">{rv.notes}</Field>}
            </div>
          </CardContent>
        </Card>

        <DocAuditCard rows={audit} />
      </div>
    );
  });
}
