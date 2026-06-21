import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { requireErpModule, erpCan } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { purchaseInvoices, purchaseInvoiceLines, suppliers, items, purchaseReceipts, purchaseReturns } from "@/db/schema";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ErpPageHeader } from "@/components/erp/page-header";
import { PurchaseInvoiceDetailActions } from "@/components/erp/purchase-invoice-detail-actions";
import { Field, LinkedDocsCard, DocAuditCard, UUID_RE, type DocLink } from "@/components/erp/document-detail";
import { getDocumentAudit } from "@/lib/erp/audit";

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

export default async function PurchaseInvoiceDetailPage({ params }: { params: Promise<{ number: string }> }) {
  const raw = decodeURIComponent((await params).number);
  const { orgId, role } = await requireErpModule("purchases.view");

  if (UUID_RE.test(raw)) {
    const [byId] = await db.select({ number: purchaseInvoices.number }).from(purchaseInvoices)
      .where(and(eq(purchaseInvoices.id, raw), eq(purchaseInvoices.organizationId, orgId))).limit(1);
    if (!byId) notFound();
    redirect(`/erp/purchases/invoices/${encodeURIComponent(byId.number)}`);
  }

  const [inv] = await db.select().from(purchaseInvoices)
    .where(and(eq(purchaseInvoices.number, raw), eq(purchaseInvoices.organizationId, orgId))).limit(1);
  if (!inv) notFound();

  const [sup] = inv.supplierId
    ? await db.select({ code: suppliers.code, name: suppliers.nameAr }).from(suppliers).where(eq(suppliers.id, inv.supplierId)).limit(1)
    : [undefined];

  const lines = await db
    .select({ id: purchaseInvoiceLines.id, qty: purchaseInvoiceLines.quantity, unitPrice: purchaseInvoiceLines.unitPrice, shipping: purchaseInvoiceLines.shippingPerUnit, discount: purchaseInvoiceLines.discountAmount, tax: purchaseInvoiceLines.taxAmount, total: purchaseInvoiceLines.totalAmount, code: items.code, name: items.nameAr })
    .from(purchaseInvoiceLines)
    .leftJoin(items, eq(items.id, purchaseInvoiceLines.itemId))
    .where(eq(purchaseInvoiceLines.purchaseInvoiceId, inv.id));
  const anyShipping = lines.some((l) => Number(l.shipping) > 0);

  const linked: DocLink[] = [];
  if (inv.goodsReceiptId) {
    const [grn] = await db.select({ number: purchaseReceipts.number }).from(purchaseReceipts).where(eq(purchaseReceipts.id, inv.goodsReceiptId)).limit(1);
    if (grn) linked.push({ label: "إذن استلام", number: grn.number, href: `/erp/purchases/receipts/${encodeURIComponent(grn.number)}` });
  }
  const rets = await db.select({ status: purchaseReturns.status }).from(purchaseReturns)
    .where(and(eq(purchaseReturns.purchaseInvoiceId, inv.id), eq(purchaseReturns.organizationId, orgId)));
  const hasReturn = rets.some((r) => r.status === "POSTED");

  const audit = await getDocumentAudit(orgId, inv.id);
  const st = STATUS[inv.status] ?? { label: inv.status, variant: "secondary" as const };
  const canPost = erpCan(role, "accounting.post");
  const canManage = erpCan(role, "purchases.create");

  return (
    <div className="space-y-6">
      <ErpPageHeader
        icon="ReceiptText"
        title={`فاتورة شراء ${inv.number}`}
        subtitle={sup ? `${sup.code} — ${sup.name}` : "فاتورة شراء"}
        backHref="/erp/purchases/invoices"
        action={<PurchaseInvoiceDetailActions id={inv.id} number={inv.number} status={inv.status} canPost={canPost} canManage={canManage} />}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="الحالة"><div className="flex items-center gap-2"><Badge variant={st.variant}>{st.label}</Badge>{hasReturn && <Badge variant="destructive">مرتجع</Badge>}</div></Field>
        <Field label="التاريخ">{dt(inv.date)}</Field>
        {Number(inv.shippingAmount) > 0 && <Field label="الشحن">{fmt(inv.shippingAmount)}</Field>}
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
                {anyShipping && <TableHead className="text-start">شحن/وحدة</TableHead>}
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
                  {anyShipping && <TableCell>{fmt(l.shipping)}</TableCell>}
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
            <div>الشحن: <span className="font-medium">{fmt(inv.shippingAmount)}</span></div>
            <div>الضريبة: <span className="font-medium">{fmt(inv.taxAmount)}</span></div>
            <div className="text-base font-bold text-primary">الإجمالي للكل: {fmt(inv.totalAmount)}</div>
          </div>
          {inv.notes && <p className="mt-4 text-sm text-muted-foreground">ملاحظات: {inv.notes}</p>}
        </CardContent>
      </Card>

      <LinkedDocsCard links={linked} />
      <DocAuditCard rows={audit} />
    </div>
  );
}
