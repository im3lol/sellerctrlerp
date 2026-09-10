import { and, asc, eq } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { orgFiscalYearStartISO } from "@/lib/erp/fiscal";
import { db } from "@/lib/db";
import { salesPlatforms } from "@/db/schema";
import { getOrderPnl, getProductPnl } from "@/lib/erp/marketplace-pnl";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ErpPageHeader } from "@/components/erp/page-header";
import { ItemSalesFilters } from "@/components/erp/item-sales-filters";
import { FeeCell } from "@/components/erp/fee-cell";

const fmt = (v: unknown) => Number(v ?? 0).toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const qtyf = (v: unknown) => Number(v ?? 0).toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 3 });
const pct = (n: number) => `${n.toFixed(1)}%`;
const dt = (d: Date | null) => (d ? new Date(d).toLocaleDateString("en-GB", { year: "numeric", month: "2-digit", day: "2-digit" }) : "—");

type SP = { [k: string]: string | string[] | undefined };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/**
 * Marketplace profitability, per order and per product.
 *
 * Both tables read the transaction feed, so a DEFERRED order shows its real fees straight
 * away instead of looking free until Amazon settles it weeks later. Cost comes from the
 * stock ledger. Fees are shown as Amazon reports them — negative — so a row reads the way
 * the Transaction details page reads.
 */
export default async function MarketplacePnlPage({ searchParams }: { searchParams: Promise<SP> }) {
  return loadErpPage("reports.view", async ({ orgId }) => {
    const sp = await searchParams;
    const from = one(sp.from) || (await orgFiscalYearStartISO(orgId));
    const to = one(sp.to) || new Date().toISOString().slice(0, 10);
    const search = one(sp.q).trim().toLowerCase();
    const fromD = new Date(from), toD = new Date(to + "T23:59:59");

    const platforms = await db.select({ id: salesPlatforms.id, code: salesPlatforms.code, name: salesPlatforms.name })
      .from(salesPlatforms).where(and(eq(salesPlatforms.organizationId, orgId), eq(salesPlatforms.isActive, true)))
      .orderBy(asc(salesPlatforms.code));
    const chosen = platforms.find((p) => p.code === one(sp.channel)) ?? platforms[0] ?? null;

    const [orders, products] = chosen
      ? await Promise.all([
          getOrderPnl(orgId, chosen.code, chosen.id, fromD, toD),
          getProductPnl(orgId, chosen.code, chosen.id, fromD, toD),
        ])
      : [[], []];

    const hit = (s: string | null | undefined) => !search || (s ?? "").toLowerCase().includes(search);
    const orderRows = orders.filter((r) => hit(r.externalOrderId) || hit(r.orderNumber));
    const productRows = products.filter((r) => hit(r.sku) || hit(r.code) || hit(r.name) || hit(r.asin));

    const tSales = orderRows.reduce((s, r) => s + r.sales + r.refunds, 0);
    const tFees = orderRows.reduce((s, r) => s + r.fees, 0);
    const tCogs = orderRows.reduce((s, r) => s + r.cogs, 0);
    const tNet = tSales + tFees - tCogs;
    const deferred = orderRows.filter((r) => r.deferred).length;
    const noCogs = orderRows.filter((r) => !r.hasCogs).length;

    return (
      <div className="space-y-6">
        <ErpPageHeader
          icon="Wallet"
          title="ربحية المنصة — بالطلب وبالمنتج"
          subtitle="من حركات أمازون الفعلية، شاملة المؤجّلة"
          backHref="/sales/reports/profitability"
        />

        {platforms.length > 1 && (
          <div className="flex flex-wrap gap-2">
            {platforms.map((p) => (
              <a key={p.id} href={`?channel=${p.code}&from=${from}&to=${to}`}
                className={`rounded-lg border px-3 py-1.5 text-sm ${p.code === chosen?.code ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
                {p.name}
              </a>
            ))}
          </div>
        )}
        <ItemSalesFilters from={from} to={to} q={search} />

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">المبيعات</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold tabular-nums">{fmt(tSales)}</p></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">رسوم أمازون</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold tabular-nums text-amber-600">{fmt(tFees)}</p></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">تكلفة البضاعة</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold tabular-nums text-muted-foreground">{fmt(tCogs)}</p></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">صافي الربح</CardTitle></CardHeader><CardContent><p className={`text-2xl font-bold tabular-nums ${tNet >= 0 ? "text-emerald-600" : "text-destructive"}`}>{fmt(tNet)}</p></CardContent></Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>على مستوى الطلب</CardTitle>
            <CardDescription>
              كل طلب وإيراده ورسومه وتكلفته — الأرقام دي هي نفسها اللي في صفحة «Transaction details» على أمازون.
              «العمولة» هي كل اللي أمازون خصمه — قف على الرقم علشان تشوف عمولة البيع ورسوم FBA وكل واحدة بأساسيها وضريبتها.
              {deferred > 0 && <span className="text-amber-600"> · {qtyf(deferred)} طلب لسه مؤجّل (أمازون ماحرّرش فلوسه بعد، بس الرسوم متحسبة).</span>}
              {noCogs > 0 && <span className="text-amber-600"> · {qtyf(noCogs)} طلب من غير تكلفة بضاعة — يعني لسه ماخرجش من المخزون.</span>}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {orderRows.length === 0 ? (
              <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">لا توجد حركات في هذه الفترة.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-start">التاريخ</TableHead>
                    <TableHead className="text-start">طلب أمازون</TableHead>
                    <TableHead className="text-start">أمر البيع</TableHead>
                    <TableHead className="text-end">المبيعات</TableHead>
                    <TableHead className="text-end">مرتجع</TableHead>
                    <TableHead className="text-end">العمولة</TableHead>
                    <TableHead className="text-end">التكلفة</TableHead>
                    <TableHead className="text-end">الصافي</TableHead>
                    <TableHead className="text-end">الهامش</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orderRows.map((r) => (
                    <TableRow key={r.externalOrderId}>
                      <TableCell className="whitespace-nowrap">{dt(r.postedAt)}</TableCell>
                      <TableCell>
                        <span className="font-mono text-xs" dir="ltr">{r.externalOrderId}</span>
                        {r.deferred && <Badge variant="secondary" className="ms-2">مؤجّل</Badge>}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{r.orderNumber ?? "—"}</TableCell>
                      <TableCell className="text-end tabular-nums">{fmt(r.sales)}</TableCell>
                      <TableCell className="text-end tabular-nums text-destructive">{r.refunds !== 0 ? fmt(r.refunds) : "—"}</TableCell>
                      <TableCell className="text-end">
                        <FeeCell commission={r.commission} commissionTax={r.commissionTax} fbaFee={r.fbaFee} fbaFeeTax={r.fbaFeeTax} otherFees={r.otherFees} />
                      </TableCell>
                      <TableCell className="text-end tabular-nums text-muted-foreground">{r.hasCogs ? fmt(r.cogs) : "—"}</TableCell>
                      <TableCell className={`text-end tabular-nums font-medium ${r.net >= 0 ? "text-emerald-600" : "text-destructive"}`}>{fmt(r.net)}</TableCell>
                      <TableCell className="text-end tabular-nums">{pct(r.margin)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>على مستوى المنتج</CardTitle>
            <CardDescription>
              الرسوم موزّعة على كل SKU — ده اللي تقرير التسويات القديم ماكانش يقدر يعمله.
              «سعر التعادل» = تكلفة القطعة + رسوم أمازون للقطعة؛ تحته المنتج بيخسر.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {productRows.length === 0 ? (
              <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">لا توجد حركات في هذه الفترة.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-start">SKU</TableHead>
                    <TableHead className="text-start">الصنف</TableHead>
                    <TableHead className="text-end">الكمية</TableHead>
                    <TableHead className="text-end">المبيعات</TableHead>
                    <TableHead className="text-end">العمولة</TableHead>
                    <TableHead className="text-end">التكلفة</TableHead>
                    <TableHead className="text-end">الصافي</TableHead>
                    <TableHead className="text-end">متوسط البيع</TableHead>
                    <TableHead className="text-end">سعر التعادل</TableHead>
                    <TableHead className="text-end">الفرق</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {productRows.map((r) => {
                    const gap = Math.round((r.unitSale - r.breakEven) * 100) / 100;
                    return (
                      <TableRow key={r.sku}>
                        <TableCell className="font-mono text-xs" dir="ltr">{r.sku}</TableCell>
                        <TableCell className="max-w-[280px] whitespace-normal">
                          <div className="line-clamp-2 leading-snug" title={r.name ?? undefined}>
                            {r.code && <span className="font-mono text-xs text-muted-foreground">{r.code}</span>} {r.name ?? <span className="text-amber-600">صنف غير مربوط</span>}
                          </div>
                        </TableCell>
                        <TableCell className="text-end tabular-nums">{qtyf(r.units)}</TableCell>
                        <TableCell className="text-end tabular-nums">{fmt(r.sales)}</TableCell>
                        <TableCell className="text-end">
                          <FeeCell commission={r.commission} commissionTax={r.commissionTax} fbaFee={r.fbaFee} fbaFeeTax={r.fbaFeeTax} otherFees={r.otherFees} />
                        </TableCell>
                        <TableCell className="text-end tabular-nums text-muted-foreground">{r.hasCogs ? fmt(r.cogs) : "—"}</TableCell>
                        <TableCell className={`text-end tabular-nums font-medium ${r.net >= 0 ? "text-emerald-600" : "text-destructive"}`}>{fmt(r.net)}</TableCell>
                        <TableCell className="text-end tabular-nums">{fmt(r.unitSale)}</TableCell>
                        <TableCell className="text-end tabular-nums font-medium">{r.hasCogs ? fmt(r.breakEven) : "—"}</TableCell>
                        <TableCell className={`text-end tabular-nums font-medium ${gap >= 0 ? "text-emerald-600" : "text-destructive"}`}>{r.hasCogs ? fmt(gap) : "—"}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    );
  });
}
