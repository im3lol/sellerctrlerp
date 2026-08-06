import Link from "next/link";
import { notFound } from "next/navigation";
import { loadErpPage } from "@/lib/erp/org";
import { orgFiscalYearStartISO } from "@/lib/erp/fiscal";
import { db } from "@/lib/db";
import { salesPlatforms } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ErpPageHeader } from "@/components/erp/page-header";
import { Icon } from "@/components/icon";
import { SettlementReverseButton } from "@/components/erp/settlement-reverse-button";

const money = (v: number) => v.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dt = (d: unknown) => (d ? new Date(d as string).toLocaleDateString("en-GB", { year: "numeric", month: "2-digit", day: "2-digit" }) : "—");
const iso = (d: Date) => d.toISOString().slice(0, 10);

type SP = { from?: string; to?: string };
type Row = { settlement_id: string; from_d: string | null; to_d: string | null; gross: string; net: string; transferred: string; n: number; currency: string | null; posted: boolean };

/**
 * Per-settlement statement — the report every Amazon/Noon seller expects: each settlement
 * grouped, showing gross sales, total deductions (fees + refunds), the settlement net, and
 * the amount transferred to the bank, so a settlement FOOTS to its payout. Figures use
 * only unambiguous values: gross from the sales columns, net from each row's net-cash
 * `total`, deductions as their difference — no per-fee-column sign guessing.
 */
export default async function PlatformStatementsPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<SP> }) {
  const { code } = await params;
  return loadErpPage("accounting.view", async ({ orgId, can }) => {
    const canReverse = can("accounting.reverse");
    const channel = code.toUpperCase();
    const [platform] = await db.select({ name: salesPlatforms.name }).from(salesPlatforms)
      .where(and(eq(salesPlatforms.organizationId, orgId), eq(salesPlatforms.code, channel))).limit(1);
    if (!platform) notFound();

    const sp = await searchParams;
    const fromStr = sp.from || (await orgFiscalYearStartISO(orgId));
    const toStr = sp.to || iso(new Date());
    const fromDate = new Date(`${fromStr}T00:00:00.000Z`);
    const toDate = new Date(`${toStr}T23:59:59.999Z`);

    // One row per settlement. Date-bucketed by the settlement's own release date range.
    const rows = (await db.execute<Row>(sql`
      SELECT settlement_id,
             min(coalesce(release_date, posted_at)) AS from_d,
             max(coalesce(release_date, posted_at)) AS to_d,
             coalesce(sum(product_sales + shipping_credits + promotional_rebates), 0) AS gross,
             coalesce(sum(total) filter (where type <> 'Transfer'), 0) AS net,
             coalesce(-sum(total) filter (where type = 'Transfer'), 0) AS transferred,
             count(*)::int AS n,
             min(currency) AS currency,
             bool_or(journal_entry_id IS NOT NULL) AS posted
      FROM marketplace_settlement_txns
      WHERE organization_id = ${orgId} AND channel = ${channel} AND settlement_id IS NOT NULL
        AND coalesce(release_date, posted_at) >= ${fromDate}
        AND coalesce(release_date, posted_at) <= ${toDate}
      GROUP BY settlement_id
      ORDER BY max(coalesce(release_date, posted_at)) DESC
    `)).rows as Row[];

    const stmts = rows.map((r) => {
      const gross = Number(r.gross), net = Number(r.net), transferred = Number(r.transferred);
      return { id: r.settlement_id, from: r.from_d, to: r.to_d, n: Number(r.n), gross, deductions: gross - net, net, transferred, diff: net - transferred, currency: r.currency, posted: r.posted };
    });
    const tot = stmts.reduce((a, s) => ({ gross: a.gross + s.gross, net: a.net + s.net, transferred: a.transferred + s.transferred }), { gross: 0, net: 0, transferred: 0 });

    return (
      <div className="space-y-6" dir="rtl">
        <ErpPageHeader
          icon="ReceiptText"
          title={`كشوف تسويات ${platform.name}`}
          subtitle="كل تسوية: المبيعات − الخصومات = الصافي، مقابل المُحوَّل للبنك — بحيث تُطابِق التسوية إيداعها"
          backHref={`/platforms/${code}`}
          action={<Button variant="outline" asChild><Link href={`/platforms/${code}/payouts`}><Icon name="Wallet" className="size-4" />المحفظة والتحويلات</Link></Button>}
        />

        <Card>
          <CardContent className="pt-6">
            <form className="flex flex-wrap items-end gap-3">
              <div className="space-y-1"><Label htmlFor="from">من تاريخ</Label><Input id="from" name="from" type="date" defaultValue={fromStr} dir="ltr" className="w-44" /></div>
              <div className="space-y-1"><Label htmlFor="to">إلى تاريخ</Label><Input id="to" name="to" type="date" defaultValue={toStr} dir="ltr" className="w-44" /></div>
              <Button type="submit">عرض</Button>
            </form>
          </CardContent>
        </Card>

        <div className="grid gap-3 sm:grid-cols-3">
          <Card><CardContent className="pt-6"><div className="text-sm text-muted-foreground">عدد التسويات</div><div className="text-2xl font-bold tabular-nums">{stmts.length.toLocaleString("ar-EG-u-nu-latn")}</div></CardContent></Card>
          <Card><CardContent className="pt-6"><div className="text-sm text-muted-foreground">صافي التسويات</div><div className="text-2xl font-bold tabular-nums">{money(tot.net)}</div></CardContent></Card>
          <Card><CardContent className="pt-6"><div className="text-sm text-muted-foreground">إجمالي المُحوَّل للبنك</div><div className="text-2xl font-bold tabular-nums text-emerald-600">{money(tot.transferred)}</div></CardContent></Card>
        </div>

        <Card>
          <CardContent className="pt-6">
            {stmts.length === 0 ? (
              <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">لا توجد تسويات في هذه الفترة. اسحب تقرير التسويات من صفحة المنصّة أولًا.</div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-start">رقم التسوية</TableHead>
                      <TableHead className="text-start">الفترة</TableHead>
                      <TableHead className="text-start">المبيعات</TableHead>
                      <TableHead className="text-start">الرسوم والمرتجعات</TableHead>
                      <TableHead className="text-start">الصافي</TableHead>
                      <TableHead className="text-start">المُحوَّل للبنك</TableHead>
                      <TableHead className="text-start">المطابقة</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {stmts.map((s) => {
                      const foots = Math.abs(s.diff) < 1 && s.transferred !== 0;
                      return (
                        <TableRow key={s.id}>
                          <TableCell className="font-mono text-xs" dir="ltr">{s.id}</TableCell>
                          <TableCell className="whitespace-nowrap text-muted-foreground">{dt(s.from)} — {dt(s.to)}</TableCell>
                          <TableCell className="tabular-nums">{money(s.gross)}</TableCell>
                          <TableCell className="tabular-nums text-destructive">−{money(s.deductions)}</TableCell>
                          <TableCell className="tabular-nums font-semibold whitespace-nowrap">{money(s.net)}{s.currency ? <span className="ms-1 text-xs text-muted-foreground">{s.currency}</span> : null}</TableCell>
                          <TableCell className="tabular-nums text-emerald-600">{s.transferred ? money(s.transferred) : "—"}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              {s.transferred === 0
                                ? <Badge variant="secondary">لم تُحوَّل بعد</Badge>
                                : foots
                                  ? <Badge variant="outline" className="border-emerald-500/40 text-emerald-600">مطابِقة</Badge>
                                  : <span className="text-xs text-amber-600" title="غالبًا رصيد مُرحّل من/إلى تسوية أخرى">فرق {money(s.diff)}</span>}
                              {canReverse && s.posted && <SettlementReverseButton channel={channel} settlementId={s.id} />}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                  <TableFooter>
                    <TableRow className="font-bold">
                      <TableCell colSpan={2}>الإجمالي</TableCell>
                      <TableCell className="tabular-nums">{money(tot.gross)}</TableCell>
                      <TableCell className="tabular-nums text-destructive">−{money(tot.gross - tot.net)}</TableCell>
                      <TableCell className="tabular-nums">{money(tot.net)}</TableCell>
                      <TableCell className="tabular-nums text-emerald-600">{money(tot.transferred)}</TableCell>
                      <TableCell />
                    </TableRow>
                  </TableFooter>
                </Table>
              </div>
            )}
            <p className="mt-3 text-xs text-muted-foreground">الصافي = المبيعات − (الرسوم + المرتجعات + الخصومات). «المطابقة» تقارن الصافي بالمبلغ المُحوَّل للبنك؛ فرقٌ صغير غالبًا رصيد مُرحّل بين تسويتين. تفاصيل الرسوم في صفحة «مصاريف المنصّة».</p>
          </CardContent>
        </Card>
      </div>
    );
  });
}
