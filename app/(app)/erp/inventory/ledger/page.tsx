import { requireErpModule } from "@/lib/erp/org";
import { getStockLedger, MOVE_TYPE, MOVE_REF } from "@/lib/erp/stock-ledger";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Icon } from "@/components/icon";
import { ErpPageHeader } from "@/components/erp/page-header";
import { ItemPickerField } from "@/components/erp/item-picker-field";

const PER_PAGE = 50;
const fmt = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qfmt = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 3 });
const dt = (d: Date) => new Date(d).toLocaleDateString("ar-EG-u-nu-latn", { year: "numeric", month: "2-digit", day: "2-digit" });
const selectCls = "flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm";

const TYPE_OPTIONS: [string, string][] = [["IN", "وارد"], ["OUT", "منصرف"], ["ADJ", "تسوية"]];

type SP = { [k: string]: string | string[] | undefined };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function StockLedgerPage({ searchParams }: { searchParams: Promise<SP> }) {
  const { orgId } = await requireErpModule("inventory.view");
  const sp = await searchParams;
  const itemId = one(sp.item);
  const fWarehouse = one(sp.warehouse);
  const fType = one(sp.type);
  const from = one(sp.from);
  const to = one(sp.to);
  const page = Math.max(1, parseInt(one(sp.page) || "1", 10) || 1);

  const { rows, totals, totalRows, itemLabel, items: itemList, warehouses: whList } = await getStockLedger(orgId, {
    itemId, warehouse: fWarehouse, type: fType, from, to, page, pageSize: PER_PAGE,
  });

  const pages = Math.max(1, Math.ceil(totalRows / PER_PAGE));
  const safePage = Math.min(page, pages);
  const hasFilters = Boolean(itemId || fWarehouse || fType || from || to);
  const filterQs = () => {
    const u = new URLSearchParams();
    if (itemId) u.set("item", itemId);
    if (fWarehouse) u.set("warehouse", fWarehouse);
    if (fType) u.set("type", fType);
    if (from) u.set("from", from);
    if (to) u.set("to", to);
    return u;
  };
  const qs = (p: number) => {
    const u = filterQs();
    u.set("page", String(p));
    return `?${u.toString()}`;
  };
  const exportHref = `/api/erp/inventory/ledger/export?${filterQs().toString()}`;

  return (
    <div className="space-y-6">
      <ErpPageHeader
        icon="ScrollText"
        title="دفتر حركة المخزون"
        subtitle={itemLabel || "أحدث حركات المخزون"}
        backHref="/erp/inventory"
        action={
          rows.length > 0 ? (
            <Button asChild variant="outline">
              <a href={exportHref}><Icon name="Download" className="size-4" />تحميل Excel</a>
            </Button>
          ) : undefined
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>تصفية</CardTitle>
          <CardDescription>ابحث عن صنف معيّن، أو حدّد المستودع أو نوع الحركة أو الفترة الزمنية. بدون اختيار صنف تظهر أحدث الحركات لكل الأصناف.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-3 sm:grid-cols-4 items-end">
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="item">الصنف</Label>
              <ItemPickerField
                name="item"
                defaultId={itemId}
                defaultLabel={itemLabel}
                placeholder="ابحث بالاسم أو الكود… (اتركه فارغاً لكل الأصناف)"
                options={itemList.map((i) => ({ id: i.id, label: `${i.code} — ${i.nameAr ?? i.nameEn ?? ""}`, hint: i.code }))}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="warehouse">المستودع</Label>
              <select id="warehouse" name="warehouse" defaultValue={fWarehouse} className={selectCls}>
                <option value="">كل المستودعات</option>
                {whList.map((w) => <option key={w.id} value={w.id}>{w.nameAr}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="type">نوع الحركة</Label>
              <select id="type" name="type" defaultValue={fType} className={selectCls}>
                <option value="">كل الأنواع</option>
                {TYPE_OPTIONS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div className="space-y-1"><Label htmlFor="from">من تاريخ</Label><Input id="from" name="from" type="date" defaultValue={from} /></div>
            <div className="space-y-1"><Label htmlFor="to">إلى تاريخ</Label><Input id="to" name="to" type="date" defaultValue={to} /></div>
            <div className="flex gap-2 sm:col-span-4">
              <Button type="submit">عرض</Button>
              {hasFilters && <Button type="button" variant="outline" asChild><a href="/erp/inventory/ledger">مسح</a></Button>}
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>الحركات</CardTitle>
          <CardDescription>{itemLabel ? "الرصيد بطريقة المتوسط المرجّح." : "أحدث الحركات أولاً عبر كل الأصناف."} — {totalRows} حركة</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {rows.length === 0 ? (
            <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">{hasFilters ? "لا توجد حركات مطابقة." : "لا توجد حركات مخزون بعد."}</div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-start">التاريخ</TableHead>
                    <TableHead className="text-start">الصنف</TableHead>
                    <TableHead className="text-start">الحركة</TableHead>
                    <TableHead className="text-start">المستند</TableHead>
                    <TableHead className="text-start">المستودع</TableHead>
                    <TableHead className="text-start">وارد</TableHead>
                    <TableHead className="text-start">منصرف</TableHead>
                    <TableHead className="text-start">التكلفة</TableHead>
                    <TableHead className="text-start">رصيد الكمية</TableHead>
                    <TableHead className="text-start">قيمة الرصيد</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r, i) => {
                    const t = MOVE_TYPE[r.type] ?? { label: r.type, tone: "adj" as const };
                    const isOut = r.type === "OUT";
                    const variant = t.tone === "in" ? "default" : t.tone === "out" ? "destructive" : "secondary";
                    return (
                      <TableRow key={i}>
                        <TableCell className="whitespace-nowrap">{dt(r.date)}</TableCell>
                        <TableCell><span className="font-mono text-xs text-muted-foreground">{r.itemCode}</span> {r.itemName}</TableCell>
                        <TableCell><Badge variant={variant}>{t.label}</Badge></TableCell>
                        <TableCell>{MOVE_REF[r.refType ?? ""] ?? r.reason ?? "—"}</TableCell>
                        <TableCell>{r.warehouse ?? "—"}</TableCell>
                        <TableCell>{!isOut ? qfmt(r.quantity) : "—"}</TableCell>
                        <TableCell>{isOut ? qfmt(r.quantity) : "—"}</TableCell>
                        <TableCell>{fmt(r.unitCost)}</TableCell>
                        <TableCell className="font-medium">{qfmt(r.balanceQuantity)}</TableCell>
                        <TableCell>{fmt(r.balanceValue)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
                <TableFooter>
                  <TableRow className="font-bold">
                    <TableCell colSpan={5}>الإجمالي (صافي {qfmt(totals.net)})</TableCell>
                    <TableCell>{qfmt(totals.inQty)}</TableCell>
                    <TableCell>{qfmt(totals.outQty)}</TableCell>
                    <TableCell colSpan={3} />
                  </TableRow>
                </TableFooter>
              </Table>
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>صفحة {safePage} من {pages}</span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={safePage <= 1} asChild={safePage > 1}>
                    {safePage > 1 ? <a href={qs(safePage - 1)}>السابق</a> : <span>السابق</span>}
                  </Button>
                  <Button variant="outline" size="sm" disabled={safePage >= pages} asChild={safePage < pages}>
                    {safePage < pages ? <a href={qs(safePage + 1)}>التالي</a> : <span>التالي</span>}
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
