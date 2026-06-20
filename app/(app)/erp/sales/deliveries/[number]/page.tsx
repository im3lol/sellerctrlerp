import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { requireErpModule, erpCan } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { deliveryNotes, deliveryNoteLines, customers, items, warehouses, salesOrders, salesInvoices } from "@/db/schema";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ErpPageHeader } from "@/components/erp/page-header";
import { FulfillmentRowActions } from "@/components/erp/fulfillment-row-actions";
import { Field, LinkedDocsCard, DocAuditCard, UUID_RE, type DocLink } from "@/components/erp/document-detail";
import { getDocumentAudit } from "@/lib/erp/audit";

const qtyf = (v: string | number | null) => Number(v ?? 0).toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 3 });
const dt = (d: Date) => new Date(d).toLocaleDateString("en-GB", { year: "numeric", month: "2-digit", day: "2-digit" });

const STATUS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" }> = {
  DRAFT: { label: "مسودة", variant: "secondary" },
  DELIVERED: { label: "تم التسليم", variant: "default" },
  INVOICED: { label: "مفوتر", variant: "default" },
};

export default async function DeliveryDetailPage({ params }: { params: Promise<{ number: string }> }) {
  const raw = decodeURIComponent((await params).number);
  const { orgId, role } = await requireErpModule("sales.view");

  if (UUID_RE.test(raw)) {
    const [byId] = await db.select({ number: deliveryNotes.number }).from(deliveryNotes)
      .where(and(eq(deliveryNotes.id, raw), eq(deliveryNotes.organizationId, orgId))).limit(1);
    if (!byId) notFound();
    redirect(`/erp/sales/deliveries/${encodeURIComponent(byId.number)}`);
  }

  const [dn] = await db.select().from(deliveryNotes)
    .where(and(eq(deliveryNotes.number, raw), eq(deliveryNotes.organizationId, orgId))).limit(1);
  if (!dn) notFound();

  const [cust] = dn.customerId
    ? await db.select({ code: customers.code, name: customers.nameAr }).from(customers).where(eq(customers.id, dn.customerId)).limit(1)
    : [undefined];
  const [wh] = await db.select({ name: warehouses.nameAr }).from(warehouses).where(eq(warehouses.id, dn.warehouseId)).limit(1);

  const lines = await db
    .select({ id: deliveryNoteLines.id, qty: deliveryNoteLines.quantity, code: items.code, name: items.nameAr })
    .from(deliveryNoteLines)
    .leftJoin(items, eq(items.id, deliveryNoteLines.itemId))
    .where(eq(deliveryNoteLines.deliveryNoteId, dn.id));

  const linked: DocLink[] = [];
  if (dn.salesOrderId) {
    const [so] = await db.select({ number: salesOrders.number }).from(salesOrders).where(eq(salesOrders.id, dn.salesOrderId)).limit(1);
    if (so) linked.push({ label: "أمر بيع", number: so.number, href: `/erp/sales/orders/${encodeURIComponent(so.number)}` });
  }
  if (dn.salesInvoiceId) {
    const [si] = await db.select({ number: salesInvoices.number }).from(salesInvoices).where(eq(salesInvoices.id, dn.salesInvoiceId)).limit(1);
    if (si) linked.push({ label: "فاتورة بيع", number: si.number, href: `/erp/sales/invoices/${encodeURIComponent(si.number)}` });
  }

  const audit = await getDocumentAudit(orgId, dn.id);
  const st = STATUS[dn.status] ?? { label: dn.status, variant: "secondary" as const };
  const canManage = erpCan(role, "sales.create");

  return (
    <div className="space-y-6">
      <ErpPageHeader
        icon="Truck"
        title={`إذن صرف ${dn.number}`}
        subtitle={cust ? `${cust.code} — ${cust.name}` : "إذن صرف"}
        backHref="/erp/sales/deliveries"
        action={<FulfillmentRowActions docId={dn.id} type="delivery" invoiced={Boolean(dn.salesInvoiceId)} canManage={canManage} />}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="الحالة"><Badge variant={st.variant}>{st.label}</Badge></Field>
        <Field label="التاريخ">{dt(dn.date)}</Field>
        <Field label="المستودع">{wh?.name ?? "—"}</Field>
        <Field label="عدد الأصناف">{qtyf(lines.length)}</Field>
      </div>

      <Card>
        <CardHeader><CardTitle>الأصناف المصروفة</CardTitle><CardDescription>البضاعة الخارجة من المخزون.</CardDescription></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-start">الصنف</TableHead>
                <TableHead className="text-start">الكمية</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((l) => (
                <TableRow key={l.id}>
                  <TableCell><span className="font-mono text-muted-foreground">{l.code}</span> {l.name}</TableCell>
                  <TableCell>{qtyf(l.qty)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {dn.notes && <p className="mt-4 text-sm text-muted-foreground">ملاحظات: {dn.notes}</p>}
        </CardContent>
      </Card>

      <LinkedDocsCard links={linked} />
      <DocAuditCard rows={audit} />
    </div>
  );
}
