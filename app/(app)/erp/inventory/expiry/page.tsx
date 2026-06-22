import { requireErpModule } from "@/lib/erp/org";
import { getExpiryReport } from "@/lib/erp/expiry";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Icon } from "@/components/icon";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ErpPageHeader } from "@/components/erp/page-header";
import { LedgerCombobox } from "@/components/erp/ledger-combobox";

const fmt = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 3 });
const intl = (n: number) => n.toLocaleString("ar-EG-u-nu-latn");
const dt = (d: Date) => new Date(d).toLocaleDateString("ar-EG-u-nu-latn", { year: "numeric", month: "2-digit", day: "2-digit" });
const selectCls = "flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm";

const STATUS_OPTIONS: [string, string][] = [["EXPIRED", "منتهي"], ["NEAR", "قرب الانتهاء"], ["OK", "سليم"]];

type SP = { [k: string]: string | string[] | undefined };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function ExpiryPage({ searchParams }: { searchParams: Promise<SP> }) {
  const { orgId } = await requireErpModule("inventory.view");
  const sp = await searchParams;
  const fProduct = one(sp.product).trim();
  const fWarehouse = one(sp.warehouse);
  const fStatus = one(sp.status);
  const within = Math.max(1, parseInt(one(sp.within) || "30", 10) || 30);

  const { rows, totals, warehouses: whList, productSuggestions, withinDays } = await getExpiryReport(orgId, {
    product: fProduct, warehouse: fWarehouse, status: fStatus, withinDays: within,
  });

  const hasFilters = Boolean(fProduct || fWarehouse || fStatus || one(sp.within));

  return (
    <div className="space-y-6">
      <ErpPageHeader icon="CalendarClock" title="تنبيهات انتهاء الصلاحية" subtitle={`${rows.length} دفعة`} backHref="/erp/inventory" />

      <div className="grid gap-4 grid-cols-2 sm:grid-cols-4">
        <Card><CardContent className="pt-6"><div className="text-sm text-muted-foreground">منتهية</div><div className="text-2xl font-bold text-destructive">{intl(totals.expiredCount)}</div></CardContent></Card>
        <Card><CardContent className="pt-6"><div className="text-sm text-muted-foreground">قيمة المنتهي</div><div className="text-2xl font-bold text-destructive">{fmt(totals.expiredValue)}</div></CardContent></Card>
        <Card><CardContent className="pt-6"><div className="text-sm text-muted-foreground">قرب الانتهاء (≤{intl(withinDays)} يوم)</div><div className="text-2xl font-bold text-amber-600">{intl(totals.nearCount)}</div></CardContent></Card>
        <Card><CardContent className="pt-6"><div className="text-sm text-muted-foreground">قيمة قرب الانتهاء</div><div className="text-2xl font-bold text-amber-600">{fmt(totals.nearValue)}</div></CardContent></Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>الدفعات حسب الصلاحية</CardTitle>
          <CardDescription>كل دفعة لها رصيد وتاريخ صلاحية، مرتّبة بالأقرب انتهاءً. «منتهي» انقضى تاريخه، «قرب الانتهاء» خلال المدة المحددة.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <details open={hasFilters} className="rounded-lg border">
            <summary className="flex cursor-pointer select-none items-center gap-2 px-4 py-2 text-sm font-medium">
              <Icon name="ListFilter" className="size-4" /> بحث وتصفية
            </summary>
            <form className="grid gap-3 p-4 pt-0 sm:grid-cols-4 items-end">
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="product">المنتج (اسم أو كود)</Label>
                <LedgerCombobox name="product" defaultValue={fProduct} placeholder="ابحث باسم الصنف أو الكود…" options={productSuggestions} />
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
                  <option value="">الكل</option>
                  {STATUS_OPTIONS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div className="space-y-1"><Label htmlFor="within">حد التنبيه (أيام)</Label><Input id="within" name="within" type="number" min="1" defaultValue={String(withinDays)} /></div>
              <div className="flex gap-2 sm:col-span-4">
                <Button type="submit">تطبيق</Button>
                {hasFilters && <Button type="button" variant="outline" asChild><a href="/erp/inventory/expiry">مسح</a></Button>}
              </div>
            </form>
          </details>

          {rows.length === 0 ? (
            <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">{hasFilters ? "لا توجد دفعات مطابقة." : "لا توجد دفعات لها تاريخ صلاحية."}</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-start">الصنف</TableHead>
                  <TableHead className="text-start">المستودع</TableHead>
                  <TableHead className="text-start">رقم التشغيلة</TableHead>
                  <TableHead className="text-start">تاريخ الصلاحية</TableHead>
                  <TableHead className="text-start">المتبقّي للانتهاء</TableHead>
                  <TableHead className="text-start">الكمية</TableHead>
                  <TableHead className="text-start">القيمة</TableHead>
                  <TableHead className="text-start">الحالة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell><span className="font-mono text-xs text-muted-foreground">{r.itemCode}</span> {r.itemName}</TableCell>
                    <TableCell>{r.warehouse}</TableCell>
                    <TableCell>{r.batchNo ?? "—"}</TableCell>
                    <TableCell className="whitespace-nowrap">{dt(r.expiryDate)}</TableCell>
                    <TableCell className={r.daysLeft < 0 ? "text-destructive" : r.daysLeft <= withinDays ? "text-amber-600" : ""}>
                      {r.daysLeft < 0 ? `انتهى منذ ${intl(-r.daysLeft)} يوم` : `${intl(r.daysLeft)} يوم`}
                    </TableCell>
                    <TableCell>{qty(r.remaining)}</TableCell>
                    <TableCell>{fmt(r.value)}</TableCell>
                    <TableCell>
                      {r.status === "EXPIRED" ? <Badge variant="destructive">منتهي</Badge> : r.status === "NEAR" ? <Badge variant="secondary">قرب الانتهاء</Badge> : <Badge variant="default">سليم</Badge>}
                    </TableCell>
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
