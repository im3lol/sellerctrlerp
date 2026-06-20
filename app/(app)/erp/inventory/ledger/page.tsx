import { and, asc, eq } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { items, warehouses, stockMovements } from "@/db/schema";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ErpPageHeader } from "@/components/erp/page-header";

const fmt = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qfmt = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 3 });
const dt = (d: Date) => new Date(d).toLocaleDateString("en-GB", { year: "numeric", month: "2-digit", day: "2-digit" });
const selectCls = "flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm";

const TYPE: Record<string, { label: string; variant: "default" | "secondary" | "destructive" }> = {
  IN: { label: "وارد", variant: "default" },
  OUT: { label: "منصرف", variant: "destructive" },
  ADJ: { label: "تسوية", variant: "secondary" },
};
const REF: Record<string, string> = {
  PURCHASE_INVOICE: "فاتورة شراء",
  SALES_INVOICE: "فاتورة بيع",
  OPENING_STOCK: "رصيد افتتاحي",
  ADJUSTMENT: "تسوية مخزون",
  TRANSFER: "تحويل مخزني",
};

export default async function StockLedgerPage({ searchParams }: { searchParams: Promise<{ item?: string }> }) {
  const { orgId } = await requireErpModule("inventory.view");
  const sp = await searchParams;
  const itemId = sp.item ?? "";

  const itemList = await db
    .select({ id: items.id, code: items.code, nameAr: items.nameAr, nameEn: items.nameEn })
    .from(items)
    .where(and(eq(items.organizationId, orgId), eq(items.isActive, true)))
    .orderBy(asc(items.code));

  type Row = {
    date: Date; number: string; type: string; refType: string | null; reason: string | null;
    quantity: string; unitCost: string; balanceQuantity: string; balanceValue: string; warehouse: string | null;
  };
  let rows: Row[] = [];
  let itemName = "";
  if (itemId) {
    const it = itemList.find((i) => i.id === itemId);
    itemName = it ? `${it.code} — ${it.nameAr ?? it.nameEn ?? ""}` : "";
    rows = await db
      .select({
        date: stockMovements.date,
        number: stockMovements.number,
        type: stockMovements.type,
        refType: stockMovements.referenceType,
        reason: stockMovements.reason,
        quantity: stockMovements.quantity,
        unitCost: stockMovements.unitCost,
        balanceQuantity: stockMovements.balanceQuantity,
        balanceValue: stockMovements.balanceValue,
        warehouse: warehouses.nameAr,
      })
      .from(stockMovements)
      .leftJoin(warehouses, eq(warehouses.id, stockMovements.warehouseId))
      .where(and(eq(stockMovements.organizationId, orgId), eq(stockMovements.itemId, itemId)))
      .orderBy(asc(stockMovements.date), asc(stockMovements.createdAt));
  }

  return (
    <div className="space-y-6">
      <ErpPageHeader icon="ScrollText" title="دفتر حركة المخزون" subtitle={itemName || "اختر صنفاً لعرض حركته"} backHref="/erp/inventory" />

      <Card>
        <CardHeader>
          <CardTitle>تصفية</CardTitle>
          <CardDescription>اختر الصنف.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-wrap items-end gap-3">
            <div className="space-y-2">
              <Label htmlFor="item">الصنف</Label>
              <select id="item" name="item" defaultValue={itemId} className={`${selectCls} min-w-64`}>
                <option value="">— اختر الصنف —</option>
                {itemList.map((i) => <option key={i.id} value={i.id}>{i.code} — {i.nameAr ?? i.nameEn}</option>)}
              </select>
            </div>
            <Button type="submit">عرض</Button>
          </form>
        </CardContent>
      </Card>

      {itemId && (
        <Card>
          <CardHeader>
            <CardTitle>الحركات</CardTitle>
            <CardDescription>الرصيد بطريقة المتوسط المرجّح.</CardDescription>
          </CardHeader>
          <CardContent>
            {rows.length === 0 ? (
              <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">لا توجد حركات لهذا الصنف.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-start">التاريخ</TableHead>
                    <TableHead className="text-start">الحركة</TableHead>
                    <TableHead className="text-start">المستند</TableHead>
                    <TableHead className="text-start">وارد</TableHead>
                    <TableHead className="text-start">منصرف</TableHead>
                    <TableHead className="text-start">التكلفة</TableHead>
                    <TableHead className="text-start">رصيد الكمية</TableHead>
                    <TableHead className="text-start">قيمة الرصيد</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r, i) => {
                    const t = TYPE[r.type] ?? { label: r.type, variant: "secondary" as const };
                    const q = Number(r.quantity);
                    const isOut = r.type === "OUT";
                    return (
                      <TableRow key={i}>
                        <TableCell>{dt(r.date)}</TableCell>
                        <TableCell><Badge variant={t.variant}>{t.label}</Badge></TableCell>
                        <TableCell>{REF[r.refType ?? ""] ?? r.reason ?? "—"}</TableCell>
                        <TableCell>{!isOut ? qfmt(q) : "—"}</TableCell>
                        <TableCell>{isOut ? qfmt(q) : "—"}</TableCell>
                        <TableCell>{fmt(Number(r.unitCost))}</TableCell>
                        <TableCell className="font-medium">{qfmt(Number(r.balanceQuantity))}</TableCell>
                        <TableCell>{fmt(Number(r.balanceValue))}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
