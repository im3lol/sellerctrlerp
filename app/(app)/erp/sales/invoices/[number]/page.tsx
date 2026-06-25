import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { requireErpModule, erpCan } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { salesInvoices, salesInvoiceLines, customers, items, deliveryNotes, salesReturns } from "@/db/schema";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ErpPageHeader } from "@/components/erp/page-header";
import { SalesInvoiceDetailActions } from "@/components/erp/sales-invoice-detail-actions";
import { Field, LinkedDocsCard, DocAuditCard, UUID_RE, type DocLink } from "@/components/erp/document-detail";
import { getDocumentAudit } from "@/lib/erp/audit";
import { AttachmentsCard } from "@/components/erp/attachments-card";

const fmt = (v: string | number | null) => Number(v ?? 0).toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = (v: string | number | null) => Number(v ?? 0).toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 3 });
const dt = (d: Date) => new Date(d).toLocaleDateString("en-GB", { year: "numeric", month: "2-digit", day: "2-digit" });

const STATUS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" }> = {
  DRAFT: { label: "مسودة", variant: "secondary" },
  POSTED: { label: "مرحّلة", variant: "default" },
  PARTIAL_PAID: { label: "مدفوعة جزئياً", variant: "default" },
  PAID: { label: "مدفوعة", variant: "default" },
  CANCELLED: { label: "ملغاة", variant: "destructive" },
};

export default async function SalesInvoiceDetailPage({ params }: { params: Promise<{ number: string }> }) {
  const raw = decodeURIComponent((await params).number);
  const { orgId, role } = await requireErpModule("sales.view");

  if (UUID_RE.test(raw)) {
    const [byId] = await db.select({ number: salesInvoices.number }).from(salesInvoices)
      .where(and(eq(salesInvoices.id, raw), eq(salesInvoices.organizationId, orgId))).limit(1);
    if (!byId) notFound();
    redirect(`/erp/sales/invoices/${encodeURIComponent(byId.number)}`);
  }

  const [inv] = await db.select().from(salesInvoices)
    .where(and(eq(salesInvoices.number, raw), eq(salesInvoices.organizationId, orgId))).limit(1);
  if (!inv) notFound();

  const [cust] = inv.customerId
    ? await db.select({ code: customers.code, name: customers.nameAr, phone: customers.phone, email: customers.email }).from(customers).where(eq(customers.id, inv.customerId)).limit(1)
    : [undefined];

  const lines = await db
    .select({ id: salesInvoiceLines.id, qty: salesInvoiceLines.quantity, unitPrice: salesInvoiceLines.unitPrice, discount: salesInvoiceLines.discountAmount, tax: salesInvoiceLines.taxAmount, total: salesInvoiceLines.totalAmount, code: items.code, name: items.nameAr })
    .from(salesInvoiceLines)
    .leftJoin(items, eq(items.id, salesInvoiceLines.itemId))
    .where(eq(salesInvoiceLines.salesInvoiceId, inv.id));

  const linked: DocLink[] = [];
  if (inv.deliveryNoteId) {
    const [dn] = await db.select({ number: deliveryNotes.number }).from(deliveryNotes).where(eq(deliveryNotes.id, inv.deliveryNoteId)).limit(1);
    if (dn) linked.push({ label: "إذن صرف", number: dn.number, href: `/erp/sales/deliveries/${encodeURIComponent(dn.number)}` });
  }
  const rets = await db.select({ status: salesReturns.status }).from(salesReturns)
    .where(and(eq(salesReturns.salesInvoiceId, inv.id), eq(salesReturns.organizationId, orgId)));
  const hasReturn = rets.some((r) => r.status === "POSTED");

  const audit = await getDocumentAudit(orgId, inv.id);
  const st = STATUS[inv.status] ?? { label: inv.status, variant: "secondary" as const };
  const canPost = erpCan(role, "accounting.post");
  const canManage = erpCan(role, "sales.create");

  return (
    <div className="space-y-6">
      <ErpPageHeader
        icon="ReceiptText"
        title={`فاتورة بيع ${inv.number}`}
        subtitle={cust ? `${cust.code} — ${cust.name}` : "فاتورة بيع"}
        backHref="/erp/sales/invoices"
        action={<SalesInvoiceDetailActions id={inv.id} number={inv.number} status={inv.status} canPost={canPost} canManage={canManage} totalAmount={String(inv.totalAmount)} customerPhone={cust?.phone ?? null} customerEmail={cust?.email ?? null} />}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="الحالة"><div className="flex items-center gap-2"><Badge variant={st.variant}>{st.label}</Badge>{hasReturn && <Badge variant="destructive">مرتجع</Badge>}</div></Field>
        <Field label="التاريخ">{dt(inv.date)}</Field>
        <Field label="الإجمالي">{fmt(inv.totalAmount)}</Field>
        <Field label="المدفوع / المتبقّي">{fmt(inv.paidAmount)} / {fmt(inv.balanceDue)}</Field>
      </div>

      <Card>
        <CardHeader><CardTitle>البنود</CardTitle><CardDescription>أصناف الفاتورة.</CardDescription></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-start">الصنف</TableHead>
                <TableHead className="text-start">الكمية</TableHead>
                <TableHead className="text-start">السعر</TableHead>
                <TableHead className="text-start">الخصم</TableHead>
                <TableHead className="text-start">الضريبة</TableHead>
                <TableHead className="text-start">الإجمالي</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((l) => (
                <TableRow key={l.id}>
                  <TableCell><span className="font-mono text-muted-foreground">{l.code}</span> {l.name}</TableCell>
                  <TableCell>{qty(l.qty)}</TableCell>
                  <TableCell>{fmt(l.unitPrice)}</TableCell>
                  <TableCell>{fmt(l.discount)}</TableCell>
                  <TableCell>{fmt(l.tax)}</TableCell>
                  <TableCell>{fmt(l.total)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <div className="mt-4 flex flex-col items-end gap-1 text-sm">
            <div>الإجمالي الفرعي: <span className="font-medium">{fmt(inv.subtotal)}</span></div>
            <div>الخصم: <span className="font-medium">{fmt(inv.discountAmount)}</span></div>
            <div>الضريبة: <span className="font-medium">{fmt(inv.taxAmount)}</span></div>
            <div className="text-base font-bold text-primary">الإجمالي للكل: {fmt(inv.totalAmount)}</div>
          </div>
          {inv.notes && <p className="mt-4 text-sm text-muted-foreground">ملاحظات: {inv.notes}</p>}
        </CardContent>
      </Card>

      <AttachmentsCard entityType="SALES_INVOICE" entityId={inv.id} canManage={canManage} />
      <LinkedDocsCard links={linked} />
      <DocAuditCard rows={audit} />
    </div>
  );
}
