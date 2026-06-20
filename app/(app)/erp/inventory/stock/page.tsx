import { sql } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ErpPageHeader } from "@/components/erp/page-header";

const fmt = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 3 });

type Row = {
  item_code: string;
  item_name: string;
  warehouse_name: string;
  min_stock: string;
  balance_quantity: string;
  balance_value: string;
};

export default async function StockBalancePage() {
  const { orgId } = await requireErpModule("inventory.view");

  // Latest running balance per item+warehouse (perpetual ledger).
  const result = await db.execute<Row>(sql`
    SELECT DISTINCT ON (sm.item_id, sm.warehouse_id)
      i.code AS item_code,
      coalesce(i.name_ar, i.name_en, i.code) AS item_name,
      coalesce(w.name_ar, w.name_en, w.code) AS warehouse_name,
      coalesce(i.min_stock, 0) AS min_stock,
      sm.balance_quantity,
      sm.balance_value
    FROM stock_movements sm
    JOIN items i ON i.id = sm.item_id
    JOIN warehouses w ON w.id = sm.warehouse_id
    WHERE sm.organization_id = ${orgId}
    ORDER BY sm.item_id, sm.warehouse_id, sm.created_at DESC, sm.id DESC
  `);
  const rows = (result.rows ?? []) as Row[];

  const lines = rows
    .map((r) => ({
      code: r.item_code,
      name: r.item_name,
      warehouse: r.warehouse_name,
      min: Number(r.min_stock),
      quantity: Number(r.balance_quantity),
      value: Number(r.balance_value),
      avgCost: Number(r.balance_quantity) > 0 ? Number(r.balance_value) / Number(r.balance_quantity) : 0,
    }))
    .filter((l) => Math.abs(l.quantity) > 1e-9 || Math.abs(l.value) > 1e-9);

  const totalValue = lines.reduce((s, l) => s + l.value, 0);

  return (
    <div className="space-y-6">
      <ErpPageHeader icon="Boxes" title="أرصدة المخزون" subtitle={`قيمة المخزون ${fmt(totalValue)} — من دفتر المخزون`} backHref="/erp/inventory" />
      <Card>
        <CardHeader>
          <CardTitle>الرصيد الحالي</CardTitle>
          <CardDescription>الكمية والتكلفة المتوسطة والقيمة لكل صنف/مستودع.</CardDescription>
        </CardHeader>
        <CardContent>
          {lines.length === 0 ? (
            <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">لا توجد حركات مخزون بعد.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-start">الكود</TableHead>
                  <TableHead className="text-start">الصنف</TableHead>
                  <TableHead className="text-start">المستودع</TableHead>
                  <TableHead className="text-start">الكمية</TableHead>
                  <TableHead className="text-start">متوسط التكلفة</TableHead>
                  <TableHead className="text-start">القيمة</TableHead>
                  <TableHead className="text-start">الحالة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((l, i) => {
                  const low = l.min > 0 && l.quantity <= l.min;
                  const out = l.quantity <= 0;
                  return (
                    <TableRow key={i}>
                      <TableCell className="font-mono">{l.code}</TableCell>
                      <TableCell>{l.name}</TableCell>
                      <TableCell>{l.warehouse}</TableCell>
                      <TableCell>{qty(l.quantity)}</TableCell>
                      <TableCell>{fmt(l.avgCost)}</TableCell>
                      <TableCell>{fmt(l.value)}</TableCell>
                      <TableCell>
                        {out ? <Badge variant="destructive">نافد</Badge> : low ? <Badge variant="secondary">منخفض</Badge> : <Badge variant="default">متوفّر</Badge>}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
              <TableFooter>
                <TableRow className="font-bold">
                  <TableCell colSpan={5}>إجمالي قيمة المخزون</TableCell>
                  <TableCell>{fmt(totalValue)}</TableCell>
                  <TableCell />
                </TableRow>
              </TableFooter>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
