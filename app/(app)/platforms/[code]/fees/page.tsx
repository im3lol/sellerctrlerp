import { and, eq, isNotNull, sql } from "drizzle-orm";
import { notFound } from "next/navigation";
import { loadErpPage } from "@/lib/erp/org";
import { orgFiscalYearStartISO } from "@/lib/erp/fiscal";
import { db } from "@/lib/db";
import { marketplaceSettlementTxns, salesPlatforms } from "@/db/schema";
import { summarizeSettlementFees, isIncomeCategory, type SettlementFeeRow } from "@/lib/erp/settlement-fees";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ErpPageHeader } from "@/components/erp/page-header";

const money = (v: number) => v.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const iso = (d: Date) => d.toISOString().slice(0, 10);

type SP = { from?: string; to?: string };

/**
 * "مصاريف المنصّة من التسويات" — every cost Amazon actually deducted in the period,
 * categorized (advertising, FBA, referral, storage, subscription …) straight from the
 * settlement report. Real money out, not estimates, and no Ads API needed: advertising
 * arrives as a non-order Service Fee row and is categorized here.
 */
export default async function PlatformFeesPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<SP> }) {
  const { code } = await params;
  return loadErpPage("accounting.view", async ({ orgId }) => {
    const channel = code.toUpperCase();
    const [platform] = await db.select({ name: salesPlatforms.name }).from(salesPlatforms)
      .where(and(eq(salesPlatforms.organizationId, orgId), eq(salesPlatforms.code, channel))).limit(1);
    if (!platform) notFound();

    const sp = await searchParams;
    const fyStart = await orgFiscalYearStartISO(orgId);
    const fromStr = sp.from || fyStart;
    const toStr = sp.to || iso(new Date());
    const fromDate = new Date(`${fromStr}T00:00:00.000Z`);
    const toDate = new Date(`${toStr}T23:59:59.999Z`);

    const rows = await db.select({
      type: marketplaceSettlementTxns.type,
      description: marketplaceSettlementTxns.description,
      sellingFees: marketplaceSettlementTxns.sellingFees,
      fbaFees: marketplaceSettlementTxns.fbaFees,
      otherTransactionFees: marketplaceSettlementTxns.otherTransactionFees,
      total: marketplaceSettlementTxns.total,
    }).from(marketplaceSettlementTxns)
      .where(and(
        eq(marketplaceSettlementTxns.organizationId, orgId),
        eq(marketplaceSettlementTxns.channel, channel),
        // Only rows actually posted to the GL — so this screen foots to the رسوم أمازون
        // (5203) / receivable balances. Counting Released-but-unposted or pre-go-live rows
        // (as the old postedAt filter did) made the total diverge from the ledger.
        isNotNull(marketplaceSettlementTxns.journalEntryId),
        // Date by the SAME basis the posting engine uses (releaseDate, postedAt fallback),
        // not Amazon's postedAt — otherwise the period boundary misaligns with the GL.
        sql`coalesce(${marketplaceSettlementTxns.releaseDate}, ${marketplaceSettlementTxns.postedAt}) >= ${fromDate}`,
        sql`coalesce(${marketplaceSettlementTxns.releaseDate}, ${marketplaceSettlementTxns.postedAt}) <= ${toDate}`,
      ));

    const feeRows: SettlementFeeRow[] = rows.map((r) => ({
      type: r.type, description: r.description,
      sellingFees: Number(r.sellingFees), fbaFees: Number(r.fbaFees),
      otherTransactionFees: Number(r.otherTransactionFees), total: Number(r.total),
    }));
    const s = summarizeSettlementFees(feeRows);

    return (
      <div className="space-y-6" dir="rtl">
        <ErpPageHeader
          icon="Percent"
          title={`مصاريف ${platform.name} من التسويات`}
          subtitle="كل ما خصمه أمازون فعليًا في الفترة — مصنّفًا (إعلانات، FBA، عمولة، تخزين…) من تقرير التسويات"
          backHref={`/platforms/${code}`}
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
          <Card><CardContent className="pt-6"><div className="text-sm text-muted-foreground">إجمالي المصاريف</div><div className="text-2xl font-bold tabular-nums text-destructive">{money(s.totalExpense)}</div></CardContent></Card>
          <Card><CardContent className="pt-6"><div className="text-sm text-muted-foreground">التعويضات (دخل)</div><div className="text-2xl font-bold tabular-nums text-emerald-600">{money(s.reimbursement)}</div></CardContent></Card>
          <Card><CardContent className="pt-6"><div className="text-sm text-muted-foreground">صافي تكلفة أمازون</div><div className="text-2xl font-bold tabular-nums">{money(s.net)}</div></CardContent></Card>
        </div>

        <Card>
          <CardContent className="pt-6">
            {s.categories.length === 0 ? (
              <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">
                لا توجد تسويات مُرحّلة إلى الدفتر في هذه الفترة. اسحب تقرير التسويات ثم رحّله من صفحة المنصّة أولًا.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-start">البند</TableHead>
                      <TableHead className="text-start">عدد الحركات</TableHead>
                      <TableHead className="text-start">المبلغ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {s.categories.map((c) => (
                      <TableRow key={c.key}>
                        <TableCell className="font-medium">{c.label}</TableCell>
                        <TableCell className="tabular-nums text-muted-foreground">{c.count.toLocaleString("ar-EG-u-nu-latn")}</TableCell>
                        <TableCell className={`tabular-nums font-semibold ${isIncomeCategory(c.key) ? "text-emerald-600" : ""}`}>
                          {isIncomeCategory(c.key) ? "+" : "−"}{money(c.amount)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            <p className="mt-3 text-xs text-muted-foreground">أرقام فعلية من تقرير تسويات أمازون — الصفوف المُرحّلة إلى الدفتر فقط، مؤرّخة بتاريخ الإصدار، فتتطابق مع رصيد حساب رسوم أمازون. الإعلانات تظهر تلقائيًا لأنها تنزل كرسوم خدمة في التسوية — بدون الحاجة لأي ربط إعلانات.</p>
          </CardContent>
        </Card>
      </div>
    );
  });
}
