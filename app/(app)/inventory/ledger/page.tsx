import Link from "next/link";
import { getT } from "@/lib/i18n/server";
import { loadErpPage } from "@/lib/erp/org";
import { getStockLedger, MOVE_TYPE, MOVE_REF } from "@/lib/erp/stock-ledger";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ReportShell } from "@/components/erp/report-shell";
import { ItemPickerField } from "@/components/erp/item-picker-field";
import { selectCls } from "@/lib/utils";

const PER_PAGE = 50;
const fmt = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qfmt = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 3 });
const dt = (d: Date) => new Date(d).toLocaleDateString("ar-EG-u-nu-latn", { year: "numeric", month: "2-digit", day: "2-digit" });

const TYPE_OPTIONS: [string, string][] = [["IN", "وارد"], ["OUT", "منصرف"], ["ADJ", "تسوية"], ["REVALUE", "إعادة تقييم"]];

type SP = { [k: string]: string | string[] | undefined };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function StockLedgerPage({ searchParams }: { searchParams: Promise<SP> }) {
  const t = await getT();
  return loadErpPage("inventory.view", async ({ orgId , permissions }) => {
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

    return (
      <ReportShell
        reportKey="inv-ledger"
        icon="ScrollText"
        title={t("دفتر حركة المخزون")}
        subtitle={`${rows.length} حركة`}
        query={filterQs().toString()}
        permissions={permissions}
      >
        <Card>
          <CardHeader>
            <CardTitle>{t("تصفية")}</CardTitle>
            <CardDescription>{t("ابحث عن صنف معيّن، أو حدّد المستودع أو نوع الحركة أو الفترة الزمنية. بدون اختيار صنف تظهر أحدث الحركات لكل الأصناف.")}</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="grid gap-3 sm:grid-cols-4 items-end">
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="item">{t("الصنف")}</Label>
                <ItemPickerField
                  name="item"
                  defaultId={itemId}
                  defaultLabel={itemLabel}
                  placeholder={t("ابحث بالاسم أو الكود… (اتركه فارغاً لكل الأصناف)")}
                  options={itemList.map((i) => ({ id: i.id, label: `${i.code} — ${i.nameAr ?? ""}`, hint: i.code }))}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="warehouse">{t("المستودع")}</Label>
                <select id="warehouse" name="warehouse" defaultValue={fWarehouse} className={selectCls}>
                  <option value="">{t("كل المستودعات")}</option>
                  {whList.map((w) => <option key={w.id} value={w.id}>{w.nameAr}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="type">{t("نوع الحركة")}</Label>
                <select id="type" name="type" defaultValue={fType} className={selectCls}>
                  <option value="">{t("كل الأنواع")}</option>
                  {TYPE_OPTIONS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div className="space-y-1"><Label htmlFor="from">{t("من تاريخ")}</Label><Input id="from" name="from" type="date" defaultValue={from} /></div>
              <div className="space-y-1"><Label htmlFor="to">{t("إلى تاريخ")}</Label><Input id="to" name="to" type="date" defaultValue={to} /></div>
              <div className="flex gap-2 sm:col-span-4">
                <Button type="submit">{t("عرض")}</Button>
                {hasFilters && <Button type="button" variant="outline" asChild><Link href="/inventory/ledger">{t("مسح")}</Link></Button>}
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("الحركات")}</CardTitle>
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
                      <TableHead className="text-start">{t("التاريخ")}</TableHead>
                      <TableHead className="w-[22rem] text-start">{t("الصنف")}</TableHead>
                      <TableHead className="text-start">{t("الحركة")}</TableHead>
                      <TableHead className="text-start">{t("المستند")}</TableHead>
                      <TableHead className="text-start">{t("المستودع")}</TableHead>
                      <TableHead className="text-start">{t("وارد")}</TableHead>
                      <TableHead className="text-start">{t("منصرف")}</TableHead>
                      <TableHead className="text-start">{t("التكلفة")}</TableHead>
                      <TableHead className="text-start">{t("رصيد الكمية")}</TableHead>
                      <TableHead className="text-start">{t("قيمة الرصيد")}</TableHead>
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
                          <TableCell className="max-w-[22rem] whitespace-normal">
                            {r.itemId ? (
                              <Link href={`/inventory/items/${r.itemId}`} className="hover:underline">
                                <div dir="ltr" className="line-clamp-2 text-start leading-snug" title={r.itemName ?? undefined}>{r.itemName}</div>
                                <div className="font-mono text-xs text-muted-foreground">{r.itemCode}</div>
                              </Link>
                            ) : (
                              <>
                                <div dir="ltr" className="line-clamp-2 text-start leading-snug" title={r.itemName ?? undefined}>{r.itemName}</div>
                                <div className="font-mono text-xs text-muted-foreground">{r.itemCode}</div>
                              </>
                            )}
                          </TableCell>
                          <TableCell><Badge variant={variant}>{t.label}</Badge></TableCell>
                          <TableCell>
                            <div>{MOVE_REF[r.refType ?? ""] ?? r.reason ?? "—"}</div>
                            {r.refNumber && (r.refHref
                              ? <Link href={r.refHref} className="font-mono text-xs text-primary hover:underline" dir="ltr">{r.refNumber}</Link>
                              : <span className="font-mono text-xs text-muted-foreground" dir="ltr">{r.refNumber}</span>)}
                          </TableCell>
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
                      <TableCell colSpan={5}>الإجمالي (صافي {qfmt(totals.net)}{totals.adjNet !== 0 ? ` — تسويات ${totals.adjNet > 0 ? "+" : ""}${qfmt(totals.adjNet)}` : ""})</TableCell>
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
                      {safePage > 1 ? <a href={qs(safePage - 1)}>{t("السابق")}</a> : <span>{t("السابق")}</span>}
                    </Button>
                    <Button variant="outline" size="sm" disabled={safePage >= pages} asChild={safePage < pages}>
                      {safePage < pages ? <a href={qs(safePage + 1)}>{t("التالي")}</a> : <span>{t("التالي")}</span>}
                    </Button>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </ReportShell>
    );
  });
}
