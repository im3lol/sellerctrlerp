import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { requireErpModule, erpCan } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { purchaseReturns, suppliers, purchaseInvoices } from "@/db/schema";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Icon } from "@/components/icon";
import { ErpPageHeader } from "@/components/erp/page-header";
import { ReturnRowActions } from "@/components/erp/return-row-actions";

const fmt = (v: string | null) => Number(v ?? 0).toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dt = (d: Date) => new Date(d).toLocaleDateString("en-GB", { year: "numeric", month: "2-digit", day: "2-digit" });

export default async function PurchaseReturnsPage() {
  const { orgId, role } = await requireErpModule("purchases.view");
  const canManage = erpCan(role, "purchases.create");
  const rows = await db
    .select({
      id: purchaseReturns.id,
      number: purchaseReturns.number,
      date: purchaseReturns.date,
      total: purchaseReturns.totalAmount,
      status: purchaseReturns.status,
      supplier: suppliers.nameAr,
      invoice: purchaseInvoices.number,
    })
    .from(purchaseReturns)
    .leftJoin(suppliers, eq(suppliers.id, purchaseReturns.supplierId))
    .leftJoin(purchaseInvoices, eq(purchaseInvoices.id, purchaseReturns.purchaseInvoiceId))
    .where(eq(purchaseReturns.organizationId, orgId))
    .orderBy(desc(purchaseReturns.date), desc(purchaseReturns.number));

  const total = rows.filter((r) => r.status === "POSTED").reduce((s, r) => s + Number(r.total), 0);

  return (
    <div className="space-y-6">
      <ErpPageHeader
        icon="Undo2"
        title="مرتجعات المشتريات"
        subtitle={`${rows.length} مرتجع — إجمالي ${fmt(String(total))}`}
        action={
          erpCan(role, "purchases.create") ? (
            <Button asChild>
              <Link href="/erp/purchases/returns/new"><Icon name="Plus" className="size-4" />مرتجع مشتريات</Link>
            </Button>
          ) : undefined
        }
      />
      <Card>
        <CardHeader>
          <CardTitle>إشعارات مدينة</CardTitle>
          <CardDescription>مرتجعات تخفّض ذمة المورد وتُخرج البضاعة من المخزون.</CardDescription>
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
                  <TableHead className="text-start">المورد</TableHead>
                  <TableHead className="text-start">الفاتورة</TableHead>
                  <TableHead className="text-start">الإجمالي</TableHead>
                  <TableHead className="text-start">الحالة</TableHead>
                  {canManage && <TableHead className="text-start">إجراءات</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono"><Link href={`/erp/purchases/returns/${encodeURIComponent(r.number)}`} className="text-primary underline">{r.number}</Link></TableCell>
                    <TableCell>{dt(r.date)}</TableCell>
                    <TableCell>{r.supplier ?? "—"}</TableCell>
                    <TableCell className="font-mono">{r.invoice ?? "—"}</TableCell>
                    <TableCell>{fmt(r.total)}</TableCell>
                    <TableCell><Badge variant={r.status === "POSTED" ? "default" : "secondary"}>{r.status === "POSTED" ? "مرحّل" : "مسودة"}</Badge></TableCell>
                    {canManage && <TableCell><ReturnRowActions returnId={r.id} type="purchase" status={r.status} canManage={canManage} /></TableCell>}
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
