import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { requireErpModule, erpCan } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { salesReturns, customers, salesInvoices } from "@/db/schema";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Icon } from "@/components/icon";
import { ErpPageHeader } from "@/components/erp/page-header";
import { ReturnRowActions } from "@/components/erp/return-row-actions";

const fmt = (v: string | null) => Number(v ?? 0).toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dt = (d: Date) => new Date(d).toLocaleDateString("en-GB", { year: "numeric", month: "2-digit", day: "2-digit" });

export default async function SalesReturnsPage() {
  const { orgId, role } = await requireErpModule("sales.view");
  const canManage = erpCan(role, "sales.create");
  const rows = await db
    .select({
      id: salesReturns.id,
      number: salesReturns.number,
      date: salesReturns.date,
      total: salesReturns.totalAmount,
      status: salesReturns.status,
      customer: customers.nameAr,
      invoice: salesInvoices.number,
    })
    .from(salesReturns)
    .leftJoin(customers, eq(customers.id, salesReturns.customerId))
    .leftJoin(salesInvoices, eq(salesInvoices.id, salesReturns.salesInvoiceId))
    .where(eq(salesReturns.organizationId, orgId))
    .orderBy(desc(salesReturns.date), desc(salesReturns.number));

  const total = rows.filter((r) => r.status === "POSTED").reduce((s, r) => s + Number(r.total), 0);

  return (
    <div className="space-y-6">
      <ErpPageHeader
        icon="Undo2"
        title="مرتجعات المبيعات"
        subtitle={`${rows.length} مرتجع — إجمالي ${fmt(String(total))}`}
        action={
          erpCan(role, "sales.create") ? (
            <Button asChild>
              <Link href="/erp/sales/returns/new"><Icon name="Plus" className="size-4" />مرتجع مبيعات</Link>
            </Button>
          ) : undefined
        }
      />
      <Card>
        <CardHeader>
          <CardTitle>إشعارات دائنة</CardTitle>
          <CardDescription>مرتجعات تخفّض ذمة العميل وتُعيد البضاعة للمخزون.</CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">لا توجد مرتجعات بعد.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-start">الرقم</TableHead>
                  <TableHead className="text-start">التاريخ</TableHead>
                  <TableHead className="text-start">العميل</TableHead>
                  <TableHead className="text-start">الفاتورة</TableHead>
                  <TableHead className="text-start">الإجمالي</TableHead>
                  <TableHead className="text-start">الحالة</TableHead>
                  {canManage && <TableHead className="text-start">إجراءات</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono"><Link href={`/erp/sales/returns/${encodeURIComponent(r.number)}`} className="text-primary underline">{r.number}</Link></TableCell>
                    <TableCell>{dt(r.date)}</TableCell>
                    <TableCell>{r.customer ?? "—"}</TableCell>
                    <TableCell className="font-mono">{r.invoice ?? "—"}</TableCell>
                    <TableCell>{fmt(r.total)}</TableCell>
                    <TableCell><Badge variant={r.status === "POSTED" ? "default" : "secondary"}>{r.status === "POSTED" ? "مرحّل" : "مسودة"}</Badge></TableCell>
                    {canManage && <TableCell><ReturnRowActions returnId={r.id} type="sales" status={r.status} canManage={canManage} /></TableCell>}
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
