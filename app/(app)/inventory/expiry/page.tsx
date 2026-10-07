import { loadErpPage } from "@/lib/erp/org";
import { fill } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";
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
  const t = await getT();
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
        title={t("انتهاء الصلاحية")}
        subtitle={fill(t("{0} دفعة لها تاريخ صلاحية"), [rows.length])}
        query={filterQs.toString()}
        permissions={permissions}
        filters={
          <>
            <ReportField label={t("المنتج (اسم أو كود)")}>
              <LedgerCombobox name="product" defaultValue={fProduct} placeholder={t("ابحث باسم الصنف أو الكود…")} options={productSuggestions} />
            </ReportField>
            <ReportField label={t("المستودع")}>
              <select name="warehouse" defaultValue={fWarehouse} className={selectCls}>
                <option value="">{t("كل المستودعات")}</option>
                {whList.map((w) => <option key={w.id} value={w.id}>{t(w.nameAr)}</option>)}
              </select>
            </ReportField>
            <ReportField label={t("الحالة")}>
              <select name="status" defaultValue={fStatus} className={selectCls}>
                <option value="">{t("الكل")}</option>
                {STATUS_OPTIONS.map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}
              </select>
            </ReportField>
            <ReportField label={t("حد التنبيه (أيام)")}>
              <Input name="within" type="number" min="1" defaultValue={String(withinDays)} />
            </ReportField>
          </>
        }
        kpis={[
          { label: "دفعات منتهية", value: intl(totals.expiredCount), tone: "loss" },
          { label: "قيمة المنتهي", value: fmt(totals.expiredValue), tone: "loss" },
          { label: fill(t("قرب الانتهاء (≤{0} يوم)"), [intl(withinDays)]), value: intl(totals.nearCount) },
          { label: "قيمة قرب الانتهاء", value: fmt(totals.nearValue) },
        ]}
      >
        <Card>
          <CardHeader>
            <CardTitle>{t("الدفعات حسب الصلاحية")}</CardTitle>
            <CardDescription>{t("كل دفعة لها رصيد وتاريخ صلاحية، مرتّبة بالأقرب انتهاءً. «منتهي» انقضى تاريخه، «قرب الانتهاء» خلال المدة المحددة.")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">

            {rows.length === 0 ? (
              <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">{hasFilters ? t("لا توجد دفعات مطابقة.") : t("لا توجد دفعات لها تاريخ صلاحية.")}</div>
            ) : (
              <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-start">{t("الصنف")}</TableHead>
                    <TableHead className="text-start">{t("المستودع")}</TableHead>
                    <TableHead className="text-start">{t("رقم التشغيلة")}</TableHead>
                    <TableHead className="text-start">{t("تاريخ الصلاحية")}</TableHead>
                    <TableHead className="text-start">{t("المتبقّي للانتهاء")}</TableHead>
                    <TableHead className="text-start">{t("الكمية")}</TableHead>
                    <TableHead className="text-start">{t("القيمة")}</TableHead>
                    <TableHead className="text-start">{t("الحالة")}</TableHead>
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
                        {r.daysLeft < 0 ? fill(t("انتهى منذ {0} يوم"), [intl(-r.daysLeft)]) : fill(t("{0} يوم"), [intl(r.daysLeft)])}
                      </TableCell>
                      <TableCell>{qty(r.remaining)}</TableCell>
                      <TableCell>{fmt(r.value)}</TableCell>
                      <TableCell>
                        {r.status === "EXPIRED" ? <Badge variant="destructive">{t("منتهي")}</Badge> : r.status === "NEAR" ? <Badge variant="secondary">{t("قرب الانتهاء")}</Badge> : <Badge variant="default">{t("سليم")}</Badge>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Pagination page={page} pages={pages} total={rows.length} unit={t("دفعة")} basePath="/inventory/expiry" params={{ product: fProduct, warehouse: fWarehouse, status: fStatus, within: one(sp.within) }} />
              </>
            )}
          </CardContent>
        </Card>
      </ReportShell>
    );
  });
}
