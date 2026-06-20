import { sql } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ErpPageHeader } from "@/components/erp/page-header";

const q = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 3 });

type Row = { code: string; name: string; min_stock: string; max_stock: string | null; on_hand: string };

export default async function ReorderPage() {
  const { orgId } = await requireErpModule("inventory.view");

  // On-hand per item (sum of latest balance across warehouses) vs reorder level.
  const res = await db.execute<Row>(sql`
    WITH latest AS (
      SELECT DISTINCT ON (item_id, warehouse_id) item_id, balance_quantity
      FROM stock_movements WHERE organization_id = ${orgId}
      ORDER BY item_id, warehouse_id, created_at DESC, id DESC
    )
    SELECT i.code, coalesce(i.name_ar, i.name_en, i.code) AS name,
           coalesce(i.min_stock, 0) AS min_stock, i.max_stock,
           coalesce(sum(l.balance_quantity), 0) AS on_hand
    FROM items i
    LEFT JOIN latest l ON l.item_id = i.id
    WHERE i.organization_id = ${orgId} AND i.is_active = true
    GROUP BY i.id
    HAVING coalesce(sum(l.balance_quantity), 0) <= coalesce(i.min_stock, 0)
    ORDER BY on_hand ASC, i.code ASC
  `);
  const rows = (res.rows as Row[]).map((r) => ({
    code: r.code, name: r.name, min: Number(r.min_stock), max: r.max_stock ? Number(r.max_stock) : null, onHand: Number(r.on_hand),
  }));

  return (
    <div className="space-y-6">
      <ErpPageHeader icon="TriangleAlert" title="تنبيهات إعادة الطلب" subtitle={`${rows.length} صنف يحتاج إعادة طلب`} backHref="/erp/inventory" />
      <Card>
        <CardHeader>
          <CardTitle>أصناف عند/تحت حد الطلب</CardTitle>
          <CardDescription>الكمية المتاحة وصلت حد الطلب — يُنصح بإنشاء أمر شراء.</CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">كل الأصناف فوق حد الطلب ✓</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-start">الكود</TableHead>
                  <TableHead className="text-start">الصنف</TableHead>
                  <TableHead className="text-start">المتاح</TableHead>
                  <TableHead className="text-start">حد الطلب</TableHead>
                  <TableHead className="text-start">الحد الأقصى</TableHead>
                  <TableHead className="text-start">المقترح طلبه</TableHead>
                  <TableHead className="text-start">الحالة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const suggested = r.max && r.max > r.onHand ? r.max - r.onHand : Math.max(r.min - r.onHand, 0);
                  return (
                    <TableRow key={r.code}>
                      <TableCell className="font-mono">{r.code}</TableCell>
                      <TableCell>{r.name}</TableCell>
                      <TableCell>{q(r.onHand)}</TableCell>
                      <TableCell>{q(r.min)}</TableCell>
                      <TableCell>{r.max ? q(r.max) : "—"}</TableCell>
                      <TableCell className="font-medium">{q(suggested)}</TableCell>
                      <TableCell>
                        {r.onHand <= 0 ? <Badge variant="destructive">نافد</Badge> : <Badge variant="secondary">منخفض</Badge>}
                      </TableCell>
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
