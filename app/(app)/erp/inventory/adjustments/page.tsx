import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { requireErpModule, erpCan } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { stockAdjustments, items, warehouses } from "@/db/schema";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Icon } from "@/components/icon";
import { ErpPageHeader } from "@/components/erp/page-header";
import { StockRowActions } from "@/components/erp/stock-row-actions";

const fmt = (v: string | null) => Number(v ?? 0).toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const q = (v: string | null) => Number(v ?? 0).toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 3 });
const dt = (d: Date) => new Date(d).toLocaleDateString("en-GB", { year: "numeric", month: "2-digit", day: "2-digit" });

export default async function AdjustmentsPage() {
  const { orgId, role } = await requireErpModule("inventory.view");
  const canManage = erpCan(role, "inventory.create");
  const rows = await db
    .select({
      id: stockAdjustments.id,
      number: stockAdjustments.number,
      date: stockAdjustments.date,
      itemName: items.nameAr,
      itemCode: items.code,
      warehouse: warehouses.nameAr,
      delta: stockAdjustments.deltaQuantity,
      totalValue: stockAdjustments.totalValue,
      reason: stockAdjustments.reason,
      status: stockAdjustments.status,
    })
    .from(stockAdjustments)
    .innerJoin(items, eq(items.id, stockAdjustments.itemId))
    .leftJoin(warehouses, eq(warehouses.id, stockAdjustments.warehouseId))
    .where(eq(stockAdjustments.organizationId, orgId))
    .orderBy(desc(stockAdjustments.date), desc(stockAdjustments.createdAt));

  return (
    <div className="space-y-6">
      <ErpPageHeader
        icon="ClipboardCheck"
        title="تسويات المخزون"
        subtitle={`${rows.length} تسوية`}
        action={
          erpCan(role, "inventory.create") ? (
            <Button asChild>
              <Link href="/erp/inventory/adjustments/new"><Icon name="Plus" className="size-4" />تسوية جديدة</Link>
            </Button>
          ) : undefined
        }
      />
      <Card>
        <CardHeader>
          <CardTitle>سجل التسويات</CardTitle>
          <CardDescription>فروقات الجرد والتالف والفاقد. تُحفظ كمسودة ثم تُؤكَّد لتمرّ من دفتر المخزون + قيد محاسبي.</CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">لا توجد تسويات بعد.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-start">الرقم</TableHead>
                  <TableHead className="text-start">التاريخ</TableHead>
                  <TableHead className="text-start">الصنف</TableHead>
                  <TableHead className="text-start">المستودع</TableHead>
                  <TableHead className="text-start">الفرق</TableHead>
                  <TableHead className="text-start">القيمة</TableHead>
                  <TableHead className="text-start">السبب</TableHead>
                  <TableHead className="text-start">الحالة</TableHead>
                  {canManage && <TableHead className="text-start">إجراءات</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono">{r.number}</TableCell>
                    <TableCell>{dt(r.date)}</TableCell>
                    <TableCell><span className="font-mono text-muted-foreground">{r.itemCode}</span> {r.itemName}</TableCell>
                    <TableCell>{r.warehouse ?? "—"}</TableCell>
                    <TableCell className={Number(r.delta) < 0 ? "text-destructive" : ""}>{q(r.delta)}</TableCell>
                    <TableCell>{fmt(r.totalValue)}</TableCell>
                    <TableCell><Badge variant="secondary">{r.reason ?? "—"}</Badge></TableCell>
                    <TableCell><Badge variant={r.status === "POSTED" ? "default" : "secondary"}>{r.status === "POSTED" ? "مرحّل" : "مسودة"}</Badge></TableCell>
                    {canManage && <TableCell><StockRowActions docId={r.id} type="adjustment" status={r.status} canManage={canManage} /></TableCell>}
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
