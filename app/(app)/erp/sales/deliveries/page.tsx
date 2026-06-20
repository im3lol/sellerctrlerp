import { desc, eq } from "drizzle-orm";
import { requireErpModule, erpCan } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { deliveryNotes, customers, salesOrders, salesInvoices } from "@/db/schema";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ErpPageHeader } from "@/components/erp/page-header";
import { FulfillmentRowActions } from "@/components/erp/fulfillment-row-actions";

const dt = (d: Date) => new Date(d).toLocaleDateString("en-GB", { year: "numeric", month: "2-digit", day: "2-digit" });

export default async function DeliveriesPage() {
  const { orgId, role } = await requireErpModule("sales.view");
  const canManage = erpCan(role, "sales.create");
  const rows = await db
    .select({
      id: deliveryNotes.id, number: deliveryNotes.number, date: deliveryNotes.date, status: deliveryNotes.status,
      customer: customers.nameAr, order: salesOrders.number, invoice: salesInvoices.number, invoiceId: deliveryNotes.salesInvoiceId,
    })
    .from(deliveryNotes)
    .leftJoin(customers, eq(customers.id, deliveryNotes.customerId))
    .leftJoin(salesOrders, eq(salesOrders.id, deliveryNotes.salesOrderId))
    .leftJoin(salesInvoices, eq(salesInvoices.id, deliveryNotes.salesInvoiceId))
    .where(eq(deliveryNotes.organizationId, orgId))
    .orderBy(desc(deliveryNotes.date), desc(deliveryNotes.number));

  return (
    <div className="space-y-6">
      <ErpPageHeader icon="Truck" title="إذون التسليم" subtitle={`${rows.length} إذن`} />
      <Card>
        <CardHeader>
          <CardTitle>إذون التسليم</CardTitle>
          <CardDescription>صرف البضاعة من المخزون + تكلفة البضاعة المباعة تُرحّل عند التسليم؛ الفاتورة تُرحّل الإيراد فقط.</CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">لا توجد إذون تسليم بعد — أنشئها من أمر بيع مؤكّد.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-start">الرقم</TableHead>
                  <TableHead className="text-start">التاريخ</TableHead>
                  <TableHead className="text-start">العميل</TableHead>
                  <TableHead className="text-start">أمر البيع</TableHead>
                  <TableHead className="text-start">الفاتورة</TableHead>
                  <TableHead className="text-start">الحالة</TableHead>
                  {canManage && <TableHead className="text-start">إجراءات</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono">{r.number}</TableCell>
                    <TableCell>{dt(r.date)}</TableCell>
                    <TableCell>{r.customer ?? "—"}</TableCell>
                    <TableCell className="font-mono">{r.order ?? "—"}</TableCell>
                    <TableCell className="font-mono">{r.invoice ?? "—"}</TableCell>
                    <TableCell><Badge variant={r.invoiceId ? "default" : "secondary"}>{r.invoiceId ? "مفوتر" : "تم التسليم"}</Badge></TableCell>
                    {canManage && <TableCell><FulfillmentRowActions docId={r.id} type="delivery" invoiced={!!r.invoiceId} canManage={canManage} /></TableCell>}
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
