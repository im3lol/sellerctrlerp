import Link from "next/link";
import { getT } from "@/lib/i18n/server";
import { loadErpPage } from "@/lib/erp/org";
import { getStockBalances } from "@/lib/erp/stock-balances";
import { Pagination } from "@/components/erp/pagination";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Icon } from "@/components/icon";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ReportShell } from "@/components/erp/report-shell";
import { LedgerCombobox } from "@/components/erp/ledger-combobox";
import { selectCls } from "@/lib/utils";

const fmt = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 3 });
const expDate = (d: Date) => new Date(d).toLocaleDateString("ar-EG-u-nu-latn", { year: "numeric", month: "2-digit", day: "2-digit" });

const STATUS_OPTIONS: [string, string][] = [["OK", "متوفّر"], ["LOW", "منخفض"], ["OUT", "نافد"]];

type SP = { [k: string]: string | string[] | undefined };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function StockBalancePage({ searchParams }: { searchParams: Promise<SP> }) {
  const t = await getT();
  return loadErpPage("inventory.view", async ({ orgId , permissions }) => {
    const sp = await searchParams;
    const fProduct = one(sp.product).trim();
    const fWarehouse = one(sp.warehouse);
    const fStatus = one(sp.status);
    const page = Math.max(1, parseInt(one(sp.page) || "1", 10) || 1);
    const PAGE_SIZE = 50;

    const { lines: allLines, totals, warehouses: whList, productSuggestions: productOptions } = await getStockBalances(orgId, {
      product: fProduct, warehouse: fWarehouse, status: fStatus,
    });
    const pages = Math.max(1, Math.ceil(allLines.length / PAGE_SIZE));
    const lines = allLines.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

    const hasFilters = Boolean(fProduct || fWarehouse || fStatus);
    const filterQs = () => {
      const u = new URLSearchParams();
      if (fProduct) u.set("product", fProduct);
      if (fWarehouse) u.set("warehouse", fWarehouse);
      if (fStatus) u.set("status", fStatus);
      return u;
    };

    return (
      <ReportShell
        reportKey="inv-stock"
        icon="Boxes"
        title={t("أرصدة المخزون")}
        subtitle={`${lines.length} صنف`}
        query={filterQs().toString()}
        permissions={permissions}
      >
        <Card>
          <CardHeader>
            <CardTitle>{t("الرصيد الحالي")}</CardTitle>
            <CardDescription>{t("الكمية والتكلفة المتوسطة والقيمة لكل صنف/مستودع. استخدم الفلاتر لحصر صنف أو مستودع أو حالة.")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <details open={hasFilters} className="rounded-lg border">
              <summary className="flex cursor-pointer select-none items-center gap-2 px-4 py-2 text-sm font-medium">
                <Icon name="ListFilter" className="size-4" /> بحث وتصفية
              </summary>
              <form className="grid gap-3 p-4 pt-0 sm:grid-cols-4 items-end">
                <div className="space-y-1 sm:col-span-2">
                  <Label htmlFor="product">{t("المنتج (اسم أو كود)")}</Label>
                  <LedgerCombobox name="product" defaultValue={fProduct} placeholder={t("ابحث باسم الصنف أو الكود…")} options={productOptions} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="warehouse">{t("المستودع")}</Label>
                  <select id="warehouse" name="warehouse" defaultValue={fWarehouse} className={selectCls}>
                    <option value="">{t("كل المستودعات")}</option>
                    {whList.map((w) => <option key={w.id} value={w.id}>{w.nameAr}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="status">{t("الحالة")}</Label>
                  <select id="status" name="status" defaultValue={fStatus} className={selectCls}>
                    <option value="">{t("كل الحالات")}</option>
                    {STATUS_OPTIONS.map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}
                  </select>
                </div>
                <div className="flex gap-2 sm:col-span-4">
                  <Button type="submit">{t("تطبيق")}</Button>
                  {hasFilters && <Button type="button" variant="outline" asChild><Link href="/inventory/stock">{t("مسح")}</Link></Button>}
                </div>
              </form>
            </details>

            {allLines.length === 0 ? (
              <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">{hasFilters ? t("لا توجد أرصدة مطابقة.") : t("لا توجد حركات مخزون بعد.")}</div>
            ) : (
              <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-start">{t("الكود")}</TableHead>
                    <TableHead className="text-start">{t("الصنف")}</TableHead>
                    <TableHead className="text-start">{t("المستودع")}</TableHead>
                    <TableHead className="text-start">{t("الكمية")}</TableHead>
                    <TableHead className="text-start">{t("متوسط التكلفة")}</TableHead>
                    <TableHead className="text-start">{t("القيمة")}</TableHead>
                    <TableHead className="text-start">{t("أقرب انتهاء")}</TableHead>
                    <TableHead className="text-start">{t("الحالة")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((l, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-mono whitespace-nowrap"><Link href={`/inventory/items/${l.itemId}`} className="text-primary hover:underline">{l.code}</Link></TableCell>
                      <TableCell className="max-w-[300px] whitespace-normal"><div dir="ltr" className="line-clamp-2 text-start leading-snug" title={l.name ?? undefined}>{l.name}</div></TableCell>
                      <TableCell className="whitespace-nowrap">{l.warehouse}</TableCell>
                      <TableCell>{qty(l.quantity)}</TableCell>
                      <TableCell>{fmt(l.avgCost)}</TableCell>
                      <TableCell>{fmt(l.value)}</TableCell>
                      <TableCell className={l.expiryStatus === "EXPIRED" ? "text-destructive whitespace-nowrap" : l.expiryStatus === "NEAR" ? "text-amber-600 whitespace-nowrap" : "text-muted-foreground whitespace-nowrap"}>
                        {l.nearestExpiry ? expDate(l.nearestExpiry) : "—"}
                      </TableCell>
                      <TableCell>
                        {l.status === "OUT" ? <Badge variant="destructive">{t("نافد")}</Badge> : l.status === "LOW" ? <Badge variant="secondary">{t("منخفض")}</Badge> : <Badge variant="default">{t("متوفّر")}</Badge>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow className="font-bold">
                    <TableCell colSpan={3}>{t("الإجمالي (كل الصفحات)")}</TableCell>
                    <TableCell>{qty(totals.quantity)}</TableCell>
                    <TableCell />
                    <TableCell>{fmt(totals.value)}</TableCell>
                    <TableCell />
                    <TableCell />
                  </TableRow>
                </TableFooter>
              </Table>
              <Pagination page={page} pages={pages} total={allLines.length} unit={t("صنف/مستودع")} basePath="/inventory/stock" params={{ product: fProduct, warehouse: fWarehouse, status: fStatus }} />
              </>
            )}
          </CardContent>
        </Card>
      </ReportShell>
    );
  });
}
