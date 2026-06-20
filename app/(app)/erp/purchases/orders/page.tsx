import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { requireErpModule, erpCan } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { purchaseOrders, suppliers } from "@/db/schema";
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

export default async function PurchaseOrdersPage() {
  const { orgId, role } = await requireErpModule("purchases.view");
  const canManage = erpCan(role, "purchases.create");
  const rows = await db
    .select({
      id: purchaseOrders.id, number: purchaseOrders.number, date: purchaseOrders.date,
      total: purchaseOrders.totalAmount, status: purchaseOrders.status, supplier: suppliers.nameAr,
    })
    .from(purchaseOrders)
    .leftJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
    .where(eq(purchaseOrders.organizationId, orgId))
    .orderBy(desc(purchaseOrders.date), desc(purchaseOrders.number));

  return (
    <div className="space-y-6">
      <ErpPageHeader
        icon="ClipboardList"
        title="أوامر الشراء"
        subtitle={`${rows.length} أمر`}
        action={canManage ? (
          <Button asChild><Link href="/erp/purchases/orders/new"><Icon name="Plus" className="size-4" />أمر شراء</Link></Button>
        ) : undefined}
      />
      <Card>
        <CardHeader>
          <CardTitle>أوامر الشراء</CardTitle>
          <CardDescription>التزامات شراء تُحوّل إلى فواتير (بدون قيد محاسبي حتى الترحيل).</CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">لا توجد أوامر شراء بعد.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-start">الرقم</TableHead>
                  <TableHead className="text-start">التاريخ</TableHead>
                  <TableHead className="text-start">المورد</TableHead>
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
                        <Link href={`/erp/purchases/orders/${encodeURIComponent(r.number)}`} className="text-primary underline">{r.number}</Link>
                      </TableCell>
                      <TableCell>{dt(r.date)}</TableCell>
                      <TableCell>{r.supplier ?? "—"}</TableCell>
                      <TableCell>{fmt(r.total)}</TableCell>
                      <TableCell><Badge variant={st.variant}>{st.label}</Badge></TableCell>
                      {canManage && <TableCell><OrderRowActions orderId={r.id} type="purchase" status={r.status} canManage={canManage} /></TableCell>}
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
