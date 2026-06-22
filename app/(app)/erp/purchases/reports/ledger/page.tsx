import { requireErpModule } from "@/lib/erp/org";
import { getPurchasesLedger } from "@/lib/erp/purchases-ledger";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Icon } from "@/components/icon";
import { ErpPageHeader } from "@/components/erp/page-header";
import { PurchasesLedgerTable } from "@/components/erp/purchases-ledger-table";

const PER_PAGE = 20;
const selectCls = "flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm";

const DOC_TYPES: [string, string][] = [
  ["ORDER", "أوامر الشراء"],
  ["RECEIPT", "إذون الاستلام"],
  ["INVOICE", "فواتير الشراء"],
  ["RETURN", "المرتجعات"],
];

type SP = { [k: string]: string | string[] | undefined };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function PurchasesLedgerPage({ searchParams }: { searchParams: Promise<SP> }) {
  const { orgId } = await requireErpModule("purchases.view");
  const sp = await searchParams;
  const fSupplier = one(sp.supplier);
  const fType = one(sp.type); // "" = all, else ORDER|RECEIPT|INVOICE|RETURN
  const from = one(sp.from);
  const to = one(sp.to);
  const fProduct = one(sp.product).trim();
  const page = Math.max(1, parseInt(one(sp.page) || "1", 10) || 1);

  const { rows, totals, suppliers: supList } = await getPurchasesLedger(orgId, {
    supplier: fSupplier, type: fType, from, to, product: fProduct,
  });

  const totalRows = rows.length;
  const pages = Math.max(1, Math.ceil(totalRows / PER_PAGE));
  const safePage = Math.min(page, pages);
  const pageRows = rows.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE);

  const hasFilters = Boolean(fSupplier || fType || from || to || fProduct);
  const filterQs = () => {
    const u = new URLSearchParams();
    if (fSupplier) u.set("supplier", fSupplier);
    if (fType) u.set("type", fType);
    if (from) u.set("from", from);
    if (to) u.set("to", to);
    if (fProduct) u.set("product", fProduct);
    return u;
  };
  const qs = (p: number) => {
    const u = filterQs();
    u.set("page", String(p));
    return `?${u.toString()}`;
  };
  const exportHref = `/api/erp/purchases/ledger/export?${filterQs().toString()}`;

  return (
    <div className="space-y-6">
      <ErpPageHeader
        icon="BookOpen"
        title="تقرير دفتر المشتريات"
        subtitle={`${totalRows} حركة`}
        action={
          totalRows > 0 ? (
            <Button asChild variant="outline">
              <a href={exportHref}><Icon name="Download" className="size-4" />تحميل Excel</a>
            </Button>
          ) : undefined
        }
      />
      <Card>
        <CardHeader>
          <CardTitle>دفتر المشتريات (Ledger)</CardTitle>
          <CardDescription>
            حصر شامل لكل حركات المشتريات — أوامر الشراء، إذون الاستلام، فواتير الشراء، والمرتجعات — مع تفصيل السعر والشحن والخصم والضريبة والإجمالي. استخدم الفلاتر لحصر مورد أو نوع وثيقة أو فترة زمنية.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <details open={hasFilters} className="rounded-lg border">
            <summary className="flex cursor-pointer select-none items-center gap-2 px-4 py-2 text-sm font-medium">
              <Icon name="ListFilter" className="size-4" /> بحث وتصفية
            </summary>
            <form className="grid gap-3 p-4 pt-0 sm:grid-cols-5 items-end">
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="product">المنتج (اسم أو كود)</Label>
                <Input id="product" name="product" defaultValue={fProduct} placeholder="ابحث باسم الصنف أو الكود…" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="supplier">المورد</Label>
                <select id="supplier" name="supplier" defaultValue={fSupplier} className={selectCls}>
                  <option value="">كل الموردين</option>
                  {supList.map((s) => <option key={s.id} value={s.id}>{s.nameAr}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="type">نوع الوثيقة</Label>
                <select id="type" name="type" defaultValue={fType} className={selectCls}>
                  <option value="">كل الأنواع</option>
                  {DOC_TYPES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div className="space-y-1"><Label htmlFor="from">من تاريخ</Label><Input id="from" name="from" type="date" defaultValue={from} /></div>
              <div className="space-y-1"><Label htmlFor="to">إلى تاريخ</Label><Input id="to" name="to" type="date" defaultValue={to} /></div>
              <div className="flex gap-2 sm:col-span-5">
                <Button type="submit">تطبيق</Button>
                {hasFilters && <Button type="button" variant="outline" asChild><a href="/erp/purchases/reports/ledger">مسح</a></Button>}
              </div>
            </form>
          </details>

          {totalRows === 0 ? (
            <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">
              {hasFilters ? "لا توجد حركات مطابقة." : "لا توجد حركات مشتريات بعد."}
            </div>
          ) : (
            <>
              <PurchasesLedgerTable rows={pageRows} totals={totals} />
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
