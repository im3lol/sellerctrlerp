import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { requireErpModule, erpCan } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { stockAdjustments, stockAdjustmentLines, items, warehouses } from "@/db/schema";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ErpPageHeader } from "@/components/erp/page-header";
import { StockRowActions } from "@/components/erp/stock-row-actions";

const fmt = (v: string | number | null) => Number(v ?? 0).toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const q = (v: string | number | null) => Number(v ?? 0).toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 3 });
const dt = (d: Date) => new Date(d).toLocaleDateString("ar-EG-u-nu-latn", { year: "numeric", month: "2-digit", day: "2-digit" });

export default async function AdjustmentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { orgId, role } = await requireErpModule("inventory.view");
  const canManage = erpCan(role, "inventory.create");

  const [adj] = await db.select().from(stockAdjustments)
    .where(and(eq(stockAdjustments.id, id), eq(stockAdjustments.organizationId, orgId))).limit(1);
  if (!adj) notFound();

  const lines = await db
    .select({
      id: stockAdjustmentLines.id,
      itemCode: items.code,
      itemName: items.nameAr,
      warehouse: warehouses.nameAr,
      entered: stockAdjustmentLines.enteredValue,
      delta: stockAdjustmentLines.deltaQuantity,
      unitCost: stockAdjustmentLines.unitCost,
      totalValue: stockAdjustmentLines.totalValue,
    })
    .from(stockAdjustmentLines)
    .leftJoin(items, eq(items.id, stockAdjustmentLines.itemId))
    .leftJoin(warehouses, eq(warehouses.id, stockAdjustmentLines.warehouseId))
    .where(eq(stockAdjustmentLines.stockAdjustmentId, id))
    .orderBy(asc(items.code));

  const isDraft = adj.status === "DRAFT";

  return (
    <div className="space-y-6">
      <ErpPageHeader
        icon="ClipboardCheck"
        title={`تسوية مخزون ${adj.number}`}
        subtitle={adj.reason}
        backHref="/erp/inventory/adjustments"
        action={canManage && isDraft ? <StockRowActions docId={adj.id} type="adjustment" status={adj.status} canManage={canManage} /> : undefined}
      />

      <Card>
        <CardHeader><CardTitle>بيانات التسوية</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-4 text-sm">
          <div><div className="text-muted-foreground">الرقم</div><div className="font-mono font-medium">{adj.number}</div></div>
          <div><div className="text-muted-foreground">التاريخ</div><div className="font-medium">{dt(adj.date)}</div></div>
          <div><div className="text-muted-foreground">الوصف / السبب</div><div className="font-medium">{adj.reason}</div></div>
          <div><div className="text-muted-foreground">الحالة</div><Badge variant={adj.status === "POSTED" ? "default" : "secondary"}>{adj.status === "POSTED" ? "مرحّل" : "مسودة"}</Badge></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>الأصناف</CardTitle>
          <CardDescription>{isDraft ? "الفرق والقيمة تقديرية حتى التأكيد." : "القيم النهائية بعد الترحيل."}</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-start">الصنف</TableHead>
                <TableHead className="text-start">المخزن</TableHead>
                <TableHead className="text-start">الكمية الفعلية</TableHead>
                <TableHead className="text-start">الفرق</TableHead>
                <TableHead className="text-start">السعر</TableHead>
                <TableHead className="text-start">القيمة</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((l) => {
                const delta = Number(l.delta);
                return (
                  <TableRow key={l.id}>
                    <TableCell><span className="font-mono text-xs text-muted-foreground">{l.itemCode}</span> {l.itemName}</TableCell>
                    <TableCell>{l.warehouse ?? "—"}</TableCell>
                    <TableCell>{q(l.entered)}</TableCell>
                    <TableCell className={delta < 0 ? "text-destructive" : delta > 0 ? "text-emerald-600" : ""}>{delta > 0 ? "+" : ""}{q(delta)}</TableCell>
                    <TableCell>{l.unitCost != null ? fmt(l.unitCost) : "—"}</TableCell>
                    <TableCell>{fmt(l.totalValue)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
            <TableFooter>
              <TableRow className="font-bold">
                <TableCell colSpan={5}>الإجمالي</TableCell>
                <TableCell>{fmt(adj.totalValue)}</TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
