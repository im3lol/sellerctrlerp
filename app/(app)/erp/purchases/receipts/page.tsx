import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { requireErpModule, erpCan } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { purchaseReceipts, suppliers, purchaseOrders, purchaseInvoices } from "@/db/schema";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ErpPageHeader } from "@/components/erp/page-header";
import { FulfillmentRowActions } from "@/components/erp/fulfillment-row-actions";

const dt = (d: Date) => new Date(d).toLocaleDateString("en-GB", { year: "numeric", month: "2-digit", day: "2-digit" });

export default async function ReceiptsPage() {
  const { orgId, role } = await requireErpModule("purchases.view");
  const canManage = erpCan(role, "purchases.create");
  const rows = await db
    .select({
      id: purchaseReceipts.id, number: purchaseReceipts.number, date: purchaseReceipts.date, status: purchaseReceipts.status,
      supplier: suppliers.nameAr, order: purchaseOrders.number, invoice: purchaseInvoices.number, invoiceId: purchaseReceipts.purchaseInvoiceId,
    })
    .from(purchaseReceipts)
    .leftJoin(suppliers, eq(suppliers.id, purchaseReceipts.supplierId))
    .leftJoin(purchaseOrders, eq(purchaseOrders.id, purchaseReceipts.purchaseOrderId))
    .leftJoin(purchaseInvoices, eq(purchaseInvoices.id, purchaseReceipts.purchaseInvoiceId))
    .where(eq(purchaseReceipts.organizationId, orgId))
    .orderBy(desc(purchaseReceipts.date), desc(purchaseReceipts.number));

  return (
    <div className="space-y-6">
      <ErpPageHeader icon="PackageCheck" title="إذون الاستلام" subtitle={`${rows.length} إذن`} />
      <Card>
        <CardHeader>
          <CardTitle>إذون استلام البضاعة (GRN)</CardTitle>
          <CardDescription>إدخال البضاعة للمخزون يُرحّل عند الاستلام (مدين المخزون / دائن بضاعة لم تُفوتر)؛ الفاتورة تُسوّي الحساب مع المورد.</CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">لا توجد إذون استلام بعد — أنشئها من أمر شراء مؤكّد.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-start">الرقم</TableHead>
                  <TableHead className="text-start">التاريخ</TableHead>
                  <TableHead className="text-start">المورد</TableHead>
                  <TableHead className="text-start">أمر الشراء</TableHead>
                  <TableHead className="text-start">الفاتورة</TableHead>
                  <TableHead className="text-start">الحالة</TableHead>
                  {canManage && <TableHead className="text-start">إجراءات</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono"><Link href={`/erp/purchases/receipts/${encodeURIComponent(r.number)}`} className="text-primary underline">{r.number}</Link></TableCell>
                    <TableCell>{dt(r.date)}</TableCell>
                    <TableCell>{r.supplier ?? "—"}</TableCell>
                    <TableCell className="font-mono">{r.order ?? "—"}</TableCell>
                    <TableCell className="font-mono">{r.invoice ?? "—"}</TableCell>
                    <TableCell><Badge variant={r.invoiceId ? "default" : "secondary"}>{r.invoiceId ? "مفوتر" : "تم الاستلام"}</Badge></TableCell>
                    {canManage && <TableCell><FulfillmentRowActions docId={r.id} type="receipt" invoiced={!!r.invoiceId} canManage={canManage} /></TableCell>}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
