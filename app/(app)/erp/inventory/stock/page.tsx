import { requireErpModule } from "@/lib/erp/org";
import { getStockBalances } from "@/lib/erp/stock-balances";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Icon } from "@/components/icon";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ErpPageHeader } from "@/components/erp/page-header";
import { LedgerCombobox } from "@/components/erp/ledger-combobox";

const fmt = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 3 });
const intl = (n: number) => n.toLocaleString("ar-EG-u-nu-latn");
const expDate = (d: Date) => new Date(d).toLocaleDateString("ar-EG-u-nu-latn", { year: "numeric", month: "2-digit", day: "2-digit" });
const selectCls = "flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm";

const STATUS_OPTIONS: [string, string][] = [["OK", "متوفّر"], ["LOW", "منخفض"], ["OUT", "نافد"]];

type SP = { [k: string]: string | string[] | undefined };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function StockBalancePage({ searchParams }: { searchParams: Promise<SP> }) {
  const { orgId } = await requireErpModule("inventory.view");
  const sp = await searchParams;
  const fProduct = one(sp.product).trim();
  const fWarehouse = one(sp.warehouse);
  const fStatus = one(sp.status);

  const { lines, totals, warehouses: whList, productSuggestions: productOptions } = await getStockBalances(orgId, {
    product: fProduct, warehouse: fWarehouse, status: fStatus,
  });

  const hasFilters = Boolean(fProduct || fWarehouse || fStatus);
  const filterQs = () => {
    const u = new URLSearchParams();
    if (fProduct) u.set("product", fProduct);
    if (fWarehouse) u.set("warehouse", fWarehouse);
    if (fStatus) u.set("status", fStatus);
    return u;
  };
  const exportHref = `/api/erp/inventory/stock/export?${filterQs().toString()}`;

  return (
    <div className="space-y-6">
      <ErpPageHeader
        icon="Boxes"
        title="أرصدة المخزون"
        subtitle={`قيمة المخزون ${fmt(totals.value)} — من دفتر المخزون`}
        backHref="/erp/inventory"
        action={
          lines.length > 0 ? (
            <Button asChild variant="outline">
              <a href={exportHref}><Icon name="Download" className="size-4" />تحميل Excel</a>
            </Button>
          ) : undefined
        }
      />

      <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
        <Card><CardContent className="pt-6"><div className="text-sm text-muted-foreground">قيمة المخزون</div><div className="text-2xl font-bold">{fmt(totals.value)}</div></CardContent></Card>
        <Card><CardContent className="pt-6"><div className="text-sm text-muted-foreground">إجمالي الكمية</div><div className="text-2xl font-bold">{qty(totals.quantity)}</div></CardContent></Card>
        <Card><CardContent className="pt-6"><div className="text-sm text-muted-foreground">عدد الأصناف</div><div className="text-2xl font-bold">{intl(totals.items)}</div></CardContent></Card>
        <Card><CardContent className="pt-6"><div className="text-sm text-muted-foreground">مخزون منخفض</div><div className="text-2xl font-bold text-amber-600">{intl(totals.low)}</div></CardContent></Card>
        <Card><CardContent className="pt-6"><div className="text-sm text-muted-foreground">مخزون نافد</div><div className="text-2xl font-bold text-destructive">{intl(totals.out)}</div></CardContent></Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>الرصيد الحالي</CardTitle>
          <CardDescription>الكمية والتكلفة المتوسطة والقيمة لكل صنف/مستودع. استخدم الفلاتر لحصر صنف أو مستودع أو حالة.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <details open={hasFilters} className="rounded-lg border">
            <summary className="flex cursor-pointer select-none items-center gap-2 px-4 py-2 text-sm font-medium">
              <Icon name="ListFilter" className="size-4" /> بحث وتصفية
            </summary>
            <form className="grid gap-3 p-4 pt-0 sm:grid-cols-4 items-end">
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="product">المنتج (اسم أو كود)</Label>
                <LedgerCombobox name="product" defaultValue={fProduct} placeholder="ابحث باسم الصنف أو الكود…" options={productOptions} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="warehouse">المستودع</Label>
                <select id="warehouse" name="warehouse" defaultValue={fWarehouse} className={selectCls}>
                  <option value="">كل المستودعات</option>
                  {whList.map((w) => <option key={w.id} value={w.id}>{w.nameAr}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="status">الحالة</Label>
                <select id="status" name="status" defaultValue={fStatus} className={selectCls}>
                  <option value="">كل الحالات</option>
                  {STATUS_OPTIONS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div className="flex gap-2 sm:col-span-4">
                <Button type="submit">تطبيق</Button>
                {hasFilters && <Button type="button" variant="outline" asChild><a href="/erp/inventory/stock">مسح</a></Button>}
              </div>
            </form>
          </details>

          {lines.length === 0 ? (
            <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">{hasFilters ? "لا توجد أرصدة مطابقة." : "لا توجد حركات مخزون بعد."}</div>
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
                  <TableHead className="text-start">أقرب انتهاء</TableHead>
                  <TableHead className="text-start">الحالة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((l, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-mono">{l.code}</TableCell>
                    <TableCell>{l.name}</TableCell>
                    <TableCell>{l.warehouse}</TableCell>
                    <TableCell>{qty(l.quantity)}</TableCell>
                    <TableCell>{fmt(l.avgCost)}</TableCell>
                    <TableCell>{fmt(l.value)}</TableCell>
                    <TableCell className={l.expiryStatus === "EXPIRED" ? "text-destructive whitespace-nowrap" : l.expiryStatus === "NEAR" ? "text-amber-600 whitespace-nowrap" : "text-muted-foreground whitespace-nowrap"}>
                      {l.nearestExpiry ? expDate(l.nearestExpiry) : "—"}
                    </TableCell>
                    <TableCell>
                      {l.status === "OUT" ? <Badge variant="destructive">نافد</Badge> : l.status === "LOW" ? <Badge variant="secondary">منخفض</Badge> : <Badge variant="default">متوفّر</Badge>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow className="font-bold">
                  <TableCell colSpan={3}>الإجمالي</TableCell>
                  <TableCell>{qty(totals.quantity)}</TableCell>
                  <TableCell />
                  <TableCell>{fmt(totals.value)}</TableCell>
                  <TableCell />
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
