import Link from "next/link";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { notFound } from "next/navigation";
import { loadErpPage } from "@/lib/erp/org";
import { orgFiscalYearStartISO } from "@/lib/erp/fiscal";
import { db } from "@/lib/db";
import { marketplaceSettlementTxns, salesPlatforms, bankAccounts, journalEntries, journalEntryLines } from "@/db/schema";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ErpPageHeader } from "@/components/erp/page-header";
import { Icon } from "@/components/icon";

const money = (v: number) => v.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dt = (d: unknown) => (d ? new Date(d as string).toLocaleDateString("en-GB", { year: "numeric", month: "2-digit", day: "2-digit" }) : "—");
const iso = (d: Date) => d.toISOString().slice(0, 10);

type SP = { from?: string; to?: string };

/**
 * "محفظة ومدفوعات المنصّة" — reconcile what the marketplace still holds vs what it
 * actually disbursed to the bank. The wallet GL (1109 Amazon / 1110 Shopify) collects
 * every order's receivable and is credited when a payout transfers to the bank, so its
 * balance = funds the marketplace hasn't remitted yet. Disbursements are the settlement
 * Transfer rows.
 */
export default async function PlatformPayoutsPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<SP> }) {
  const { code } = await params;
  return loadErpPage("accounting.view", async ({ orgId }) => {
    const channel = code.toUpperCase();
    const [platform] = await db.select({ name: salesPlatforms.name, bankAccountId: salesPlatforms.bankAccountId })
      .from(salesPlatforms).where(and(eq(salesPlatforms.organizationId, orgId), eq(salesPlatforms.code, channel))).limit(1);
    if (!platform) notFound();

    // The platform's payout bank sits on the dedicated wallet GL — its balance is the
    // unremitted amount. Fall back gracefully for a manual platform with no wallet bank.
    const wallet = platform.bankAccountId
      ? (await db.select({ gl: bankAccounts.glAccountId, name: bankAccounts.nameAr }).from(bankAccounts)
          .where(and(eq(bankAccounts.organizationId, orgId), eq(bankAccounts.id, platform.bankAccountId))).limit(1))[0]
      : undefined;

    const sp = await searchParams;
    const fromStr = sp.from || (await orgFiscalYearStartISO(orgId));
    const toStr = sp.to || iso(new Date());
    const fromDate = new Date(`${fromStr}T00:00:00.000Z`);
    const toDate = new Date(`${toStr}T23:59:59.999Z`);

    // Unremitted wallet balance (all-time Dr − Cr on the wallet GL).
    const walletBalance = wallet?.gl
      ? Number((await db.select({ b: sql<string>`coalesce(sum(${journalEntryLines.debit} - ${journalEntryLines.credit}), 0)` })
          .from(journalEntryLines)
          .innerJoin(journalEntries, eq(journalEntries.id, journalEntryLines.journalEntryId))
          .where(and(eq(journalEntries.organizationId, orgId), eq(journalEntries.status, "POSTED"), eq(journalEntryLines.accountId, wallet.gl))))[0]?.b ?? 0)
      : 0;

    // Disbursements = settlement Transfer rows (money leaving the wallet → bank; stored negative).
    const transfers = await db.select({
      postedAt: marketplaceSettlementTxns.postedAt,
      settlementId: marketplaceSettlementTxns.settlementId,
      total: marketplaceSettlementTxns.total,
    }).from(marketplaceSettlementTxns)
      .where(and(
        eq(marketplaceSettlementTxns.organizationId, orgId),
        eq(marketplaceSettlementTxns.channel, channel),
        eq(marketplaceSettlementTxns.type, "Transfer"),
        gte(marketplaceSettlementTxns.postedAt, fromDate),
        lte(marketplaceSettlementTxns.postedAt, toDate),
      ))
      .orderBy(desc(marketplaceSettlementTxns.postedAt));

    const disbursements = transfers.map((t) => ({ ...t, amount: -Number(t.total) }));
    const totalDisbursed = disbursements.reduce((s, d) => s + d.amount, 0);

    return (
      <div className="space-y-6" dir="rtl">
        <ErpPageHeader
          icon="Wallet"
          title={`محفظة ومدفوعات ${platform.name}`}
          subtitle="ما لم تُحوّله المنصّة بعد مقابل ما أودعته في البنك — من التسويات"
          backHref={`/platforms/${code}`}
          action={<Button variant="outline" asChild><Link href={`/platforms/${code}/statements`}><Icon name="ReceiptText" className="size-4" />كشوف التسويات</Link></Button>}
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
          <Card><CardContent className="pt-6"><div className="text-sm text-muted-foreground">رصيد المحفظة الآن (لم يُحوَّل بعد)</div><div className="text-2xl font-bold tabular-nums">{money(walletBalance)}</div><div className="text-xs text-muted-foreground">رصيد حالي — لا يتأثر بفلتر التاريخ</div></CardContent></Card>
          <Card><CardContent className="pt-6"><div className="text-sm text-muted-foreground">إجمالي المُحوَّل للبنك (خلال الفترة)</div><div className="text-2xl font-bold tabular-nums text-emerald-600">{money(totalDisbursed)}</div></CardContent></Card>
          <Card><CardContent className="pt-6"><div className="text-sm text-muted-foreground">عدد التحويلات (خلال الفترة)</div><div className="text-2xl font-bold tabular-nums">{disbursements.length.toLocaleString("ar-EG-u-nu-latn")}</div></CardContent></Card>
        </div>

        <Card>
          <CardContent className="pt-6">
            {!wallet?.gl ? (
              <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">لا توجد محفظة مرتبطة بهذه المنصّة. جهّز المنصّة تلقائيًا لإنشاء بنك التسويات.</div>
            ) : disbursements.length === 0 ? (
              <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">لا توجد تحويلات في هذه الفترة.</div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-start">التاريخ</TableHead>
                      <TableHead className="text-start">رقم التسوية</TableHead>
                      <TableHead className="text-start">المبلغ المُحوَّل</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {disbursements.map((dsb, i) => (
                      <TableRow key={`${dsb.settlementId}-${i}`}>
                        <TableCell className="tabular-nums">{dt(dsb.postedAt)}</TableCell>
                        <TableCell className="font-mono text-xs" dir="ltr">{dsb.settlementId || "—"}</TableCell>
                        <TableCell className="tabular-nums font-semibold text-emerald-600">{money(dsb.amount)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            <p className="mt-3 text-xs text-muted-foreground">رصيد المحفظة = ما حصّلته المنصّة من مبيعاتك ولم تُودِعه في بنكك بعد (حساب المحفظة {wallet?.name ?? ""}). التحويلات من صفوف «Transfer» في تقرير التسويات.</p>
          </CardContent>
        </Card>
      </div>
    );
  });
}
