import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { requireErpModule, erpCan } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { salesOrders, customers } from "@/db/schema";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Icon } from "@/components/icon";
import { ErpPageHeader } from "@/components/erp/page-header";
import { OrderRowActions } from "@/components/erp/order-row-actions";

const fmt = (v: string | null) => Number(v ?? 0).toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dt = (d: Date) => new Date(d).toLocaleDateString("en-GB", { year: "numeric", month: "2-digit", day: "2-digit" });
const STATUS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" }> = {
  DRAFT: { label: "مسودة", variant: "secondary" },
  CONFIRMED: { label: "مؤكّد", variant: "default" },
  INVOICED: { label: "محوّل لفاتورة", variant: "default" },
  CANCELLED: { label: "ملغى", variant: "destructive" },
};

export default async function SalesOrdersPage() {
  const { orgId, role } = await requireErpModule("sales.view");
  const canManage = erpCan(role, "sales.create");
  const rows = await db
    .select({
      id: salesOrders.id, number: salesOrders.number, date: salesOrders.date,
      total: salesOrders.totalAmount, status: salesOrders.status, customer: customers.nameAr,
    })
    .from(salesOrders)
    .leftJoin(customers, eq(customers.id, salesOrders.customerId))
    .where(eq(salesOrders.organizationId, orgId))
    .orderBy(desc(salesOrders.date), desc(salesOrders.number));

  return (
    <div className="space-y-6">
      <ErpPageHeader
        icon="ClipboardList"
        title="أوامر البيع"
        subtitle={`${rows.length} أمر`}
        action={canManage ? (
          <Button asChild><Link href="/erp/sales/orders/new"><Icon name="Plus" className="size-4" />أمر بيع</Link></Button>
        ) : undefined}
      />
      <Card>
        <CardHeader>
          <CardTitle>أوامر البيع</CardTitle>
          <CardDescription>التزامات بيع تُحوّل إلى فواتير (بدون قيد محاسبي حتى الترحيل).</CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">لا توجد أوامر بيع بعد.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-start">الرقم</TableHead>
                  <TableHead className="text-start">التاريخ</TableHead>
                  <TableHead className="text-start">العميل</TableHead>
                  <TableHead className="text-start">الإجمالي</TableHead>
                  <TableHead className="text-start">الحالة</TableHead>
                  {canManage && <TableHead className="text-start">إجراءات</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const st = STATUS[r.status] ?? { label: r.status, variant: "secondary" as const };
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono">
                        <Link href={`/erp/sales/orders/${encodeURIComponent(r.number)}`} className="text-primary underline">{r.number}</Link>
                      </TableCell>
                      <TableCell>{dt(r.date)}</TableCell>
                      <TableCell>{r.customer ?? "—"}</TableCell>
                      <TableCell>{fmt(r.total)}</TableCell>
                      <TableCell><Badge variant={st.variant}>{st.label}</Badge></TableCell>
                      {canManage && <TableCell><OrderRowActions orderId={r.id} type="sales" status={r.status} canManage={canManage} /></TableCell>}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
