import { requireErpModule } from "@/lib/erp/org";
import { getSalesLedger } from "@/lib/erp/sales-ledger";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Icon } from "@/components/icon";
import { ErpPageHeader } from "@/components/erp/page-header";
import { SalesLedgerTable } from "@/components/erp/sales-ledger-table";

const PER_PAGE = 20;
const selectCls = "flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm";

const DOC_TYPES: [string, string][] = [
  ["ORDER", "أوامر البيع"],
  ["DELIVERY", "إذون الصرف"],
  ["INVOICE", "فواتير البيع"],
  ["RETURN", "المرتجعات"],
];

type SP = { [k: string]: string | string[] | undefined };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function SalesLedgerPage({ searchParams }: { searchParams: Promise<SP> }) {
  const { orgId } = await requireErpModule("sales.view");
  const sp = await searchParams;
  const fCustomer = one(sp.customer).trim();
  const fType = one(sp.type); // "" = all, else ORDER|DELIVERY|INVOICE|RETURN
  const from = one(sp.from);
  const to = one(sp.to);
  const fProduct = one(sp.product).trim();
  const page = Math.max(1, parseInt(one(sp.page) || "1", 10) || 1);

  const { rows, totals, customers: custList, items: itemList } = await getSalesLedger(orgId, {
    customer: fCustomer, type: fType, from, to, product: fProduct,
  });

  const totalRows = rows.length;
  const pages = Math.max(1, Math.ceil(totalRows / PER_PAGE));
  const safePage = Math.min(page, pages);
  const pageRows = rows.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE);

  const hasFilters = Boolean(fCustomer || fType || from || to || fProduct);
  const filterQs = () => {
    const u = new URLSearchParams();
    if (fCustomer) u.set("customer", fCustomer);
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
  const exportHref = `/api/erp/sales/ledger/export?${filterQs().toString()}`;

  return (
    <div className="space-y-6">
      <ErpPageHeader
        icon="BookOpen"
        title="تقرير دفتر المبيعات"
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
          <CardTitle>دفتر المبيعات (Ledger)</CardTitle>
          <CardDescription>
            حصر شامل لكل حركات المبيعات — أوامر البيع، إذون الصرف، فواتير البيع، والمرتجعات — مع تفصيل السعر والخصم والضريبة والإجمالي. استخدم الفلاتر لحصر عميل أو منتج أو نوع وثيقة أو فترة زمنية.
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
                <Input id="product" name="product" defaultValue={fProduct} placeholder="ابحث باسم الصنف أو الكود…" list="ledger-products" autoComplete="off" />
                <datalist id="ledger-products">
                  {itemList.map((it) => (
                    <option key={it.id} value={it.nameAr ?? it.code}>{it.code}</option>
                  ))}
                </datalist>
              </div>
              <div className="space-y-1">
                <Label htmlFor="customer">العميل (اسم أو كود)</Label>
                <Input id="customer" name="customer" defaultValue={fCustomer} placeholder="ابحث باسم العميل أو الكود…" list="ledger-customers" autoComplete="off" />
                <datalist id="ledger-customers">
                  {custList.map((c) => (
                    <option key={c.id} value={c.nameAr ?? c.code}>{c.code}</option>
                  ))}
                </datalist>
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
                {hasFilters && <Button type="button" variant="outline" asChild><a href="/erp/sales/reports/ledger">مسح</a></Button>}
              </div>
            </form>
          </details>

          {totalRows === 0 ? (
            <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">
              {hasFilters ? "لا توجد حركات مطابقة." : "لا توجد حركات مبيعات بعد."}
            </div>
          ) : (
            <>
              <SalesLedgerTable rows={pageRows} totals={totals} />
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
