import Link from "next/link";
import { count, desc, eq, inArray, sql } from "drizzle-orm";
import { requireErpModule, erpCan } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { stockAdjustments, stockAdjustmentLines } from "@/db/schema";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Icon } from "@/components/icon";
import { ErpPageHeader } from "@/components/erp/page-header";
import { StockRowActions } from "@/components/erp/stock-row-actions";

const fmt = (v: string | number | null) => Number(v ?? 0).toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const intl = (n: number) => n.toLocaleString("ar-EG-u-nu-latn");
const dt = (d: Date) => new Date(d).toLocaleDateString("ar-EG-u-nu-latn", { year: "numeric", month: "2-digit", day: "2-digit" });

export default async function AdjustmentsPage() {
  const { orgId, role } = await requireErpModule("inventory.view");
  const canManage = erpCan(role, "inventory.create");

  const heads = await db
    .select({
      id: stockAdjustments.id,
      number: stockAdjustments.number,
      date: stockAdjustments.date,
      totalValue: stockAdjustments.totalValue,
      reason: stockAdjustments.reason,
      status: stockAdjustments.status,
    })
    .from(stockAdjustments)
    .where(eq(stockAdjustments.organizationId, orgId))
    .orderBy(desc(stockAdjustments.date), desc(stockAdjustments.createdAt));

  const ids = heads.map((h) => h.id);
  const agg = ids.length
    ? await db
        .select({ aid: stockAdjustmentLines.stockAdjustmentId, c: count(), delta: sql<string>`coalesce(sum(${stockAdjustmentLines.deltaQuantity}),0)` })
        .from(stockAdjustmentLines)
        .where(inArray(stockAdjustmentLines.stockAdjustmentId, ids))
        .groupBy(stockAdjustmentLines.stockAdjustmentId)
    : [];
  const aggMap = new Map(agg.map((a) => [a.aid, a]));

  return (
    <div className="space-y-6">
      <ErpPageHeader
        icon="ClipboardCheck"
        title="تسويات المخزون"
        subtitle={`${heads.length} تسوية`}
        action={
          canManage ? (
            <Button asChild>
              <Link href="/erp/inventory/adjustments/new"><Icon name="Plus" className="size-4" />تسوية جديدة</Link>
            </Button>
          ) : undefined
        }
      />
      <Card>
        <CardHeader>
          <CardTitle>سجل التسويات</CardTitle>
          <CardDescription>فروقات الجرد والتالف والفاقد (متعددة الأصناف). تُحفظ كمسودة ثم تُؤكَّد لتمرّ من دفتر المخزون + قيد محاسبي.</CardDescription>
        </CardHeader>
        <CardContent>
          {heads.length === 0 ? (
            <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">لا توجد تسويات بعد.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-start">الرقم</TableHead>
                  <TableHead className="text-start">التاريخ</TableHead>
                  <TableHead className="text-start">الوصف</TableHead>
                  <TableHead className="text-start">عدد الأصناف</TableHead>
                  <TableHead className="text-start">صافي الفرق</TableHead>
                  <TableHead className="text-start">القيمة</TableHead>
                  <TableHead className="text-start">الحالة</TableHead>
                  {canManage && <TableHead className="text-start">إجراءات</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {heads.map((r) => {
                  const a = aggMap.get(r.id);
                  const delta = Number(a?.delta ?? 0);
                  return (
                    <TableRow key={r.id}>
                      <TableCell>
                        <Link href={`/erp/inventory/adjustments/${r.id}`} className="font-mono hover:text-primary">{r.number}</Link>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{dt(r.date)}</TableCell>
                      <TableCell><Badge variant="secondary">{r.reason ?? "—"}</Badge></TableCell>
                      <TableCell>{intl(Number(a?.c ?? 0))}</TableCell>
                      <TableCell className={delta < 0 ? "text-destructive" : delta > 0 ? "text-emerald-600" : ""}>{delta > 0 ? "+" : ""}{intl(delta)}</TableCell>
                      <TableCell>{fmt(r.totalValue)}</TableCell>
                      <TableCell><Badge variant={r.status === "POSTED" ? "default" : "secondary"}>{r.status === "POSTED" ? "مرحّل" : "مسودة"}</Badge></TableCell>
                      {canManage && <TableCell><StockRowActions docId={r.id} type="adjustment" status={r.status} canManage={canManage} /></TableCell>}
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
