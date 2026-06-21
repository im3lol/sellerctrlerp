import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { requireErpModule, erpCan } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { purchaseReceipts, purchaseReceiptLines, suppliers, items, warehouses, purchaseOrders, purchaseInvoices } from "@/db/schema";
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
  RECEIVED: { label: "تم الاستلام", variant: "default" },
  INVOICED: { label: "مفوتر", variant: "default" },
};

export default async function ReceiptDetailPage({ params }: { params: Promise<{ number: string }> }) {
  const raw = decodeURIComponent((await params).number);
  const { orgId, role } = await requireErpModule("purchases.view");

  if (UUID_RE.test(raw)) {
    const [byId] = await db.select({ number: purchaseReceipts.number }).from(purchaseReceipts)
      .where(and(eq(purchaseReceipts.id, raw), eq(purchaseReceipts.organizationId, orgId))).limit(1);
    if (!byId) notFound();
    redirect(`/erp/purchases/receipts/${encodeURIComponent(byId.number)}`);
  }

  const [grn] = await db.select().from(purchaseReceipts)
    .where(and(eq(purchaseReceipts.number, raw), eq(purchaseReceipts.organizationId, orgId))).limit(1);
  if (!grn) notFound();

  const [sup] = grn.supplierId
    ? await db.select({ code: suppliers.code, name: suppliers.nameAr }).from(suppliers).where(eq(suppliers.id, grn.supplierId)).limit(1)
    : [undefined];
  const [wh] = await db.select({ name: warehouses.nameAr }).from(warehouses).where(eq(warehouses.id, grn.warehouseId)).limit(1);

  const lines = await db
    .select({ id: purchaseReceiptLines.id, qty: purchaseReceiptLines.quantity, rejected: purchaseReceiptLines.rejectedQty, code: items.code, name: items.nameAr, wh: warehouses.nameAr })
    .from(purchaseReceiptLines)
    .leftJoin(items, eq(items.id, purchaseReceiptLines.itemId))
    .leftJoin(warehouses, eq(warehouses.id, purchaseReceiptLines.warehouseId))
    .where(eq(purchaseReceiptLines.purchaseReceiptId, grn.id));
  const anyRejected = lines.some((l) => Number(l.rejected) > 0);

  const linked: DocLink[] = [];
  if (grn.purchaseOrderId) {
    const [po] = await db.select({ number: purchaseOrders.number }).from(purchaseOrders).where(eq(purchaseOrders.id, grn.purchaseOrderId)).limit(1);
    if (po) linked.push({ label: "أمر شراء", number: po.number, href: `/erp/purchases/orders/${encodeURIComponent(po.number)}` });
  }
  if (grn.purchaseInvoiceId) {
    const [pi] = await db.select({ number: purchaseInvoices.number }).from(purchaseInvoices).where(eq(purchaseInvoices.id, grn.purchaseInvoiceId)).limit(1);
    if (pi) linked.push({ label: "فاتورة شراء", number: pi.number, href: `/erp/purchases/invoices/${encodeURIComponent(pi.number)}` });
  }

  const audit = await getDocumentAudit(orgId, grn.id);
  const st = STATUS[grn.status] ?? { label: grn.status, variant: "secondary" as const };
  const canManage = erpCan(role, "purchases.create");

  return (
    <div className="space-y-6">
      <ErpPageHeader
        icon="PackageCheck"
        title={`إذن استلام ${grn.number}`}
        subtitle={sup ? `${sup.code} — ${sup.name}` : "إذن استلام"}
        backHref="/erp/purchases/receipts"
        action={<FulfillmentRowActions docId={grn.id} type="receipt" invoiced={Boolean(grn.purchaseInvoiceId)} canManage={canManage} />}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="الحالة"><Badge variant={st.variant}>{st.label}</Badge></Field>
        <Field label="التاريخ">{dt(grn.date)}</Field>
        <Field label="المستودع">{wh?.name ?? "—"}</Field>
        <Field label="عدد الأصناف">{qtyf(lines.length)}</Field>
      </div>

      <Card>
        <CardHeader><CardTitle>الأصناف المستلمة</CardTitle><CardDescription>البضاعة الداخلة للمخزون.</CardDescription></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-start">الصنف</TableHead>
                <TableHead className="text-start">مخزن الاستلام</TableHead>
                <TableHead className="text-start">الكمية المستلمة</TableHead>
                {anyRejected && <TableHead className="text-start">الكمية المرفوضة</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((l) => (
                <TableRow key={l.id}>
                  <TableCell><span className="font-mono text-muted-foreground">{l.code}</span> {l.name}</TableCell>
                  <TableCell>{l.wh ?? wh?.name ?? "—"}</TableCell>
                  <TableCell>{qtyf(l.qty)}</TableCell>
                  {anyRejected && <TableCell className={Number(l.rejected) > 0 ? "text-destructive" : "text-muted-foreground"}>{qtyf(l.rejected)}</TableCell>}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {grn.notes && <p className="mt-4 text-sm text-muted-foreground">ملاحظات: {grn.notes}</p>}
        </CardContent>
      </Card>

      <LinkedDocsCard links={linked} />
      <DocAuditCard rows={audit} />
    </div>
  );
}
