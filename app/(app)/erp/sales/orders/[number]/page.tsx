import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { requireErpModule, erpCan } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { salesOrders, salesOrderLines, customers, items, deliveryNotes, salesInvoices } from "@/db/schema";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ErpPageHeader } from "@/components/erp/page-header";
import { OrderRowActions } from "@/components/erp/order-row-actions";
import { Icon } from "@/components/icon";
import { Field, LinkedDocsCard, DocAuditCard, UUID_RE, type DocLink } from "@/components/erp/document-detail";
import { getDocumentAudit } from "@/lib/erp/audit";

const fmt = (v: string | number | null) => Number(v ?? 0).toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = (v: string | number | null) => Number(v ?? 0).toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 3 });
const dt = (d: Date) => new Date(d).toLocaleDateString("en-GB", { year: "numeric", month: "2-digit", day: "2-digit" });

const STATUS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" }> = {
  DRAFT: { label: "مسودة", variant: "secondary" },
  CONFIRMED: { label: "مؤكّد", variant: "default" },
  PARTIALLY_DELIVERED: { label: "تسليم جزئي", variant: "secondary" },
  DELIVERED: { label: "تم التسليم", variant: "default" },
  INVOICED: { label: "مفوتر", variant: "default" },
  CANCELLED: { label: "ملغى", variant: "destructive" },
};

export default async function SalesOrderDetailPage({ params }: { params: Promise<{ number: string }> }) {
  const raw = decodeURIComponent((await params).number);
  const { orgId, role } = await requireErpModule("sales.view");

  if (UUID_RE.test(raw)) {
    const [byId] = await db.select({ number: salesOrders.number }).from(salesOrders)
      .where(and(eq(salesOrders.id, raw), eq(salesOrders.organizationId, orgId))).limit(1);
    if (!byId) notFound();
    redirect(`/erp/sales/orders/${encodeURIComponent(byId.number)}`);
  }

  const [so] = await db.select().from(salesOrders)
    .where(and(eq(salesOrders.number, raw), eq(salesOrders.organizationId, orgId))).limit(1);
  if (!so) notFound();

  const [cust] = so.customerId
    ? await db.select({ code: customers.code, name: customers.nameAr }).from(customers).where(eq(customers.id, so.customerId)).limit(1)
    : [undefined];

  const lines = await db
    .select({ id: salesOrderLines.id, qty: salesOrderLines.quantity, unitPrice: salesOrderLines.unitPrice, discount: salesOrderLines.discountAmount, tax: salesOrderLines.taxAmount, total: salesOrderLines.totalAmount, code: items.code, name: items.nameAr })
    .from(salesOrderLines)
    .leftJoin(items, eq(items.id, salesOrderLines.itemId))
    .where(eq(salesOrderLines.salesOrderId, so.id));

  // Linked documents in the cycle: delivery note → its invoice.
  const dns = await db.select({ id: deliveryNotes.id, number: deliveryNotes.number, invoiceId: deliveryNotes.salesInvoiceId })
    .from(deliveryNotes).where(eq(deliveryNotes.salesOrderId, so.id));
  const linked: DocLink[] = [];
  for (const dn of dns) {
    linked.push({ label: "إذن صرف", number: dn.number, href: `/erp/sales/deliveries/${encodeURIComponent(dn.number)}` });
    if (dn.invoiceId) {
      const [inv] = await db.select({ number: salesInvoices.number }).from(salesInvoices).where(eq(salesInvoices.id, dn.invoiceId)).limit(1);
      if (inv) linked.push({ label: "فاتورة بيع", number: inv.number, href: `/erp/sales/invoices/${encodeURIComponent(inv.number)}` });
    }
  }

  const audit = await getDocumentAudit(orgId, so.id);
  const st = STATUS[so.status] ?? { label: so.status, variant: "secondary" as const };
  const canManage = erpCan(role, "sales.create");

  return (
    <div className="space-y-6">
      <ErpPageHeader
        icon="ClipboardList"
        title={`أمر بيع ${so.number}`}
        subtitle={cust ? `${cust.code} — ${cust.name}` : "أمر بيع"}
        backHref="/erp/sales/orders"
        action={
          <div className="flex gap-2">
            <Button size="sm" variant="outline" asChild>
              <Link href={`/erp/sales/orders/${encodeURIComponent(so.number)}/print`} target="_blank">
                <Icon name="Printer" className="size-4" />طباعة
              </Link>
            </Button>
            <OrderRowActions orderId={so.id} type="sales" status={so.status} canManage={canManage} />
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="الحالة"><Badge variant={st.variant}>{st.label}</Badge></Field>
        <Field label="التاريخ">{dt(so.date)}</Field>
        <Field label="تاريخ الاستحقاق">{so.dueDate ? dt(so.dueDate) : "—"}</Field>
        <Field label="الإجمالي">{fmt(so.totalAmount)}</Field>
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
                <TableCell>{fmt(so.totalAmount)}</TableCell>
              </TableRow>
            </TableFooter>
          </Table>
          {so.notes && <p className="mt-4 text-sm text-muted-foreground">ملاحظات: {so.notes}</p>}
        </CardContent>
      </Card>

      <LinkedDocsCard links={linked} />
      <DocAuditCard rows={audit} />
    </div>
  );
}
