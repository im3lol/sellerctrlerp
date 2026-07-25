import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { paymentVouchers, suppliers, purchaseInvoices, accounts } from "@/db/schema";
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

export default async function PaymentVoucherDetailPage({ params }: { params: Promise<{ number: string }> }) {
  const raw = decodeURIComponent((await params).number);
  return loadErpPage("purchases.view", async ({ orgId, can }) => {
    if (UUID_RE.test(raw)) {
      const [byId] = await db.select({ number: paymentVouchers.number }).from(paymentVouchers)
        .where(and(eq(paymentVouchers.id, raw), eq(paymentVouchers.organizationId, orgId))).limit(1);
      if (!byId) notFound();
      redirect(`/purchases/payments/${encodeURIComponent(byId.number)}`);
    }

    const [pv] = await db.select().from(paymentVouchers)
      .where(and(eq(paymentVouchers.number, raw), eq(paymentVouchers.organizationId, orgId))).limit(1);
    if (!pv) notFound();

    const [[sup], [inv], [acc], audit] = await Promise.all([
      db.select({ name: suppliers.nameAr }).from(suppliers).where(eq(suppliers.id, pv.supplierId)).limit(1),
      pv.purchaseInvoiceId
        ? db.select({ number: purchaseInvoices.number }).from(purchaseInvoices).where(eq(purchaseInvoices.id, pv.purchaseInvoiceId)).limit(1)
        : Promise.resolve([] as { number: string }[]),
      pv.cashAccountId
        ? db.select({ code: accounts.code, name: accounts.nameAr }).from(accounts).where(eq(accounts.id, pv.cashAccountId)).limit(1)
        : Promise.resolve([] as { code: string; name: string }[]),
      getDocumentAudit(orgId, pv.id),
    ]);

    const st = STATUS[pv.status] ?? { label: pv.status, variant: "secondary" as const };

    return (
      <div className="space-y-6">
        <ErpPageHeader
          icon="Wallet"
          title={`سند صرف ${pv.number}`}
          subtitle={`${sup?.name ?? "—"} · ${dt(pv.date)}`}
          backHref="/purchases/payments"
          action={<div className="flex items-center gap-3"><Badge variant={st.variant}>{st.label}</Badge><VoucherDetailActions id={pv.id} number={pv.number} type="payment" status={pv.status} canManage={can("purchases.pay")} /></div>}
        />

        <Card>
          <CardHeader><CardTitle>بيانات السند</CardTitle></CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="المورد">{sup?.name ?? "—"}</Field>
              <Field label="المبلغ"><span className="tabular-nums">{fmt(pv.amount)}</span></Field>
              <Field label="طريقة السداد">{METHOD[pv.paymentMethod] ?? pv.paymentMethod}</Field>
              <Field label="التاريخ">{dt(pv.date)}</Field>
              <Field label="حساب النقدية/البنك">{acc ? `${acc.code} — ${acc.name}` : "—"}</Field>
              <Field label="الفاتورة">{inv?.number ?? "تحت الحساب"}</Field>
              {pv.reference && <Field label="المرجع">{pv.reference}</Field>}
              {pv.notes && <Field label="ملاحظات">{pv.notes}</Field>}
            </div>
          </CardContent>
        </Card>

        <DocAuditCard rows={audit} />
      </div>
    );
  });
}
