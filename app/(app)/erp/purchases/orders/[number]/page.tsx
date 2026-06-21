import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { requireErpModule, erpCan } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { purchaseOrders, purchaseOrderLines, suppliers, items, purchaseReceipts, purchaseInvoices } from "@/db/schema";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ErpPageHeader } from "@/components/erp/page-header";
import { OrderRowActions } from "@/components/erp/order-row-actions";
import { Field, LinkedDocsCard, DocAuditCard, UUID_RE, type DocLink } from "@/components/erp/document-detail";
import { getDocumentAudit } from "@/lib/erp/audit";

const fmt = (v: string | number | null) => Number(v ?? 0).toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = (v: string | number | null) => Number(v ?? 0).toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 3 });
const dt = (d: Date) => new Date(d).toLocaleDateString("en-GB", { year: "numeric", month: "2-digit", day: "2-digit" });

const STATUS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" }> = {
  DRAFT: { label: "مسودة", variant: "secondary" },
  CONFIRMED: { label: "مؤكّد", variant: "default" },
  PARTIALLY_RECEIVED: { label: "استلام جزئي", variant: "secondary" },
  RECEIVED: { label: "تم الاستلام", variant: "default" },
  INVOICED: { label: "مفوتر", variant: "default" },
  CANCELLED: { label: "ملغى", variant: "destructive" },
};

export default async function PurchaseOrderDetailPage({ params }: { params: Promise<{ number: string }> }) {
  const raw = decodeURIComponent((await params).number);
  const { orgId, role } = await requireErpModule("purchases.view");

  if (UUID_RE.test(raw)) {
    const [byId] = await db.select({ number: purchaseOrders.number }).from(purchaseOrders)
      .where(and(eq(purchaseOrders.id, raw), eq(purchaseOrders.organizationId, orgId))).limit(1);
    if (!byId) notFound();
    redirect(`/erp/purchases/orders/${encodeURIComponent(byId.number)}`);
  }

  const [po] = await db.select().from(purchaseOrders)
    .where(and(eq(purchaseOrders.number, raw), eq(purchaseOrders.organizationId, orgId))).limit(1);
  if (!po) notFound();

  const [sup] = po.supplierId
    ? await db.select({ code: suppliers.code, name: suppliers.nameAr }).from(suppliers).where(eq(suppliers.id, po.supplierId)).limit(1)
    : [undefined];

  const lines = await db
    .select({ id: purchaseOrderLines.id, qty: purchaseOrderLines.quantity, unitPrice: purchaseOrderLines.unitPrice, discount: purchaseOrderLines.discountAmount, tax: purchaseOrderLines.taxAmount, total: purchaseOrderLines.totalAmount, code: items.code, name: items.nameAr })
    .from(purchaseOrderLines)
    .leftJoin(items, eq(items.id, purchaseOrderLines.itemId))
    .where(eq(purchaseOrderLines.purchaseOrderId, po.id));

  const grns = await db.select({ id: purchaseReceipts.id, number: purchaseReceipts.number, invoiceId: purchaseReceipts.purchaseInvoiceId })
    .from(purchaseReceipts).where(eq(purchaseReceipts.purchaseOrderId, po.id));
  const linked: DocLink[] = [];
  for (const grn of grns) {
    linked.push({ label: "إذن استلام", number: grn.number, href: `/erp/purchases/receipts/${encodeURIComponent(grn.number)}` });
    if (grn.invoiceId) {
      const [inv] = await db.select({ number: purchaseInvoices.number }).from(purchaseInvoices).where(eq(purchaseInvoices.id, grn.invoiceId)).limit(1);
      if (inv) linked.push({ label: "فاتورة شراء", number: inv.number, href: `/erp/purchases/invoices/${encodeURIComponent(inv.number)}` });
    }
  }

  const audit = await getDocumentAudit(orgId, po.id);
  const st = STATUS[po.status] ?? { label: po.status, variant: "secondary" as const };
  const canManage = erpCan(role, "purchases.create");

  return (
    <div className="space-y-6">
      <ErpPageHeader
        icon="ClipboardList"
        title={`أمر شراء ${po.number}`}
        subtitle={sup ? `${sup.code} — ${sup.name}` : "أمر شراء"}
        backHref="/erp/purchases/orders"
        action={<OrderRowActions orderId={po.id} type="purchase" status={po.status} canManage={canManage} />}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="الحالة"><Badge variant={st.variant}>{st.label}</Badge></Field>
        <Field label="التاريخ">{dt(po.date)}</Field>
        <Field label="الإجمالي">{fmt(po.totalAmount)}</Field>
        <Field label="الضريبة">{fmt(po.taxAmount)}</Field>
      </div>

      <Card>
        <CardHeader><CardTitle>البنود</CardTitle><CardDescription>أصناف الأمر.</CardDescription></CardHeader>
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
            <TableFooter>
              <TableRow className="font-bold">
                <TableCell colSpan={5}>الإجمالي</TableCell>
                <TableCell>{fmt(po.totalAmount)}</TableCell>
              </TableRow>
            </TableFooter>
          </Table>
          {po.notes && <p className="mt-4 text-sm text-muted-foreground">ملاحظات: {po.notes}</p>}
        </CardContent>
      </Card>

      <LinkedDocsCard links={linked} />
      <DocAuditCard rows={audit} />
    </div>
  );
}
