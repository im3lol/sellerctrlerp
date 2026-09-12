import { loadErpPage } from "@/lib/erp/org";
import { getExpiryReport } from "@/lib/erp/expiry";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ReportShell, ReportField } from "@/components/erp/report-shell";
import { LedgerCombobox } from "@/components/erp/ledger-combobox";
import { Pagination } from "@/components/erp/pagination";
import { selectCls } from "@/lib/utils";

const fmt = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 3 });
const intl = (n: number) => n.toLocaleString("ar-EG-u-nu-latn");
const dt = (d: Date) => new Date(d).toLocaleDateString("ar-EG-u-nu-latn", { year: "numeric", month: "2-digit", day: "2-digit" });

const STATUS_OPTIONS: [string, string][] = [["EXPIRED", "منتهي"], ["NEAR", "قرب الانتهاء"], ["OK", "سليم"]];

type SP = { [k: string]: string | string[] | undefined };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function ExpiryPage({ searchParams }: { searchParams: Promise<SP> }) {
  return loadErpPage("inventory.view", async ({ orgId, permissions }) => {
    const sp = await searchParams;
    const fProduct = one(sp.product).trim();
    const fWarehouse = one(sp.warehouse);
    const fStatus = one(sp.status);
    const within = Math.max(1, parseInt(one(sp.within) || "30", 10) || 30);

    const { rows, totals, warehouses: whList, productSuggestions, withinDays } = await getExpiryReport(orgId, {
      product: fProduct, warehouse: fWarehouse, status: fStatus, withinDays: within,
    });

    const hasFilters = Boolean(fProduct || fWarehouse || fStatus || one(sp.within));
    const filterQs = new URLSearchParams();
    if (fProduct) filterQs.set("product", fProduct);
    if (fWarehouse) filterQs.set("warehouse", fWarehouse);
    if (fStatus) filterQs.set("status", fStatus);
    if (one(sp.within)) filterQs.set("within", one(sp.within));
    const page = Math.max(1, parseInt(one(sp.page) || "1", 10) || 1);
    const PAGE_SIZE = 50;
    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

    return (
      <ReportShell
        reportKey="inv-expiry"
        icon="CalendarClock"
        title="انتهاء الصلاحية"
        subtitle={`${rows.length} دفعة لها تاريخ صلاحية`}
        query={filterQs.toString()}
        permissions={permissions}
        filters={
          <>
            <ReportField label="المنتج (اسم أو كود)">
              <LedgerCombobox name="product" defaultValue={fProduct} placeholder="ابحث باسم الصنف أو الكود…" options={productSuggestions} />
            </ReportField>
            <ReportField label="المستودع">
              <select name="warehouse" defaultValue={fWarehouse} className={selectCls}>
                <option value="">كل المستودعات</option>
                {whList.map((w) => <option key={w.id} value={w.id}>{w.nameAr}</option>)}
              </select>
            </ReportField>
            <ReportField label="الحالة">
              <select name="status" defaultValue={fStatus} className={selectCls}>
                <option value="">الكل</option>
                {STATUS_OPTIONS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </ReportField>
            <ReportField label="حد التنبيه (أيام)">
              <Input name="within" type="number" min="1" defaultValue={String(withinDays)} />
            </ReportField>
          </>
        }
        kpis={[
          { label: "دفعات منتهية", value: intl(totals.expiredCount), tone: "loss" },
          { label: "قيمة المنتهي", value: fmt(totals.expiredValue), tone: "loss" },
          { label: `قرب الانتهاء (≤${intl(withinDays)} يوم)`, value: intl(totals.nearCount) },
          { label: "قيمة قرب الانتهاء", value: fmt(totals.nearValue) },
        ]}
      >
        <Card>
          <CardHeader>
            <CardTitle>الدفعات حسب الصلاحية</CardTitle>
            <CardDescription>كل دفعة لها رصيد وتاريخ صلاحية، مرتّبة بالأقرب انتهاءً. «منتهي» انقضى تاريخه، «قرب الانتهاء» خلال المدة المحددة.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">

            {rows.length === 0 ? (
              <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">{hasFilters ? "لا توجد دفعات مطابقة." : "لا توجد دفعات لها تاريخ صلاحية."}</div>
            ) : (
              <>
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
                  {pageRows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="max-w-[320px] whitespace-normal"><div className="line-clamp-2 leading-snug" title={r.itemName ?? undefined}><span className="font-mono text-xs text-muted-foreground">{r.itemCode}</span> {r.itemName}</div></TableCell>
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
              <Pagination page={page} pages={pages} total={rows.length} unit="دفعة" basePath="/inventory/expiry" params={{ product: fProduct, warehouse: fWarehouse, status: fStatus, within: one(sp.within) }} />
              </>
            )}
          </CardContent>
        </Card>
      </ReportShell>
    );
  });
}
