import { and, asc, eq, gte, lt, lte, sql } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { accounts, journalEntries, journalEntryLines } from "@/db/schema";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ErpPageHeader } from "@/components/erp/page-header";

const fmt = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dt = (d: Date) => new Date(d).toLocaleDateString("en-GB", { year: "numeric", month: "2-digit", day: "2-digit" });
const selectCls = "flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm";

export default async function GeneralLedgerPage({
  searchParams,
}: {
  searchParams: Promise<{ account?: string; from?: string; to?: string }>;
}) {
  const { orgId } = await requireErpModule("accounting.view");
  const sp = await searchParams;
  const accountId = sp.account ?? "";
  const from = sp.from ?? "";
  const to = sp.to ?? "";

  // Leaf accounts for the selector (only detail accounts hold entries).
  const accountList = await db
    .select({ id: accounts.id, code: accounts.code, nameAr: accounts.nameAr })
    .from(accounts)
    .where(and(eq(accounts.organizationId, orgId), eq(accounts.isLeaf, true)))
    .orderBy(asc(accounts.code));

  type Row = { date: Date; number: string; reference: string | null; description: string | null; debit: string; credit: string };
  let rows: Row[] = [];
  let opening = 0;
  let accountName = "";

  if (accountId) {
    const acc = accountList.find((a) => a.id === accountId);
    accountName = acc ? `${acc.code} — ${acc.nameAr}` : "";

    const postedFor = (extra: ReturnType<typeof and>[]) =>
      and(
        eq(journalEntryLines.accountId, accountId),
        eq(journalEntries.organizationId, orgId),
        eq(journalEntries.status, "POSTED"),
        ...extra,
      );

    // Opening balance = movements strictly before `from`.
    if (from) {
      const [op] = await db
        .select({ bal: sql<string>`coalesce(sum(${journalEntryLines.debit} - ${journalEntryLines.credit}), 0)` })
        .from(journalEntryLines)
        .innerJoin(journalEntries, eq(journalEntries.id, journalEntryLines.journalEntryId))
        .where(postedFor([lt(journalEntries.date, new Date(from))]));
      opening = Number(op?.bal ?? 0);
    }

    const range = [] as ReturnType<typeof and>[];
    if (from) range.push(gte(journalEntries.date, new Date(from)));
    if (to) range.push(lte(journalEntries.date, new Date(`${to}T23:59:59`)));

    rows = await db
      .select({
        date: journalEntries.date,
        number: journalEntries.number,
        reference: journalEntries.reference,
        description: journalEntries.description,
        debit: journalEntryLines.debit,
        credit: journalEntryLines.credit,
      })
      .from(journalEntryLines)
      .innerJoin(journalEntries, eq(journalEntries.id, journalEntryLines.journalEntryId))
      .where(postedFor(range))
      .orderBy(asc(journalEntries.date), asc(journalEntries.number));
  }

  let running = opening;
  const totalDebit = rows.reduce((s, r) => s + Number(r.debit), 0);
  const totalCredit = rows.reduce((s, r) => s + Number(r.credit), 0);

  return (
    <div className="space-y-6">
      <ErpPageHeader icon="BookOpen" title="دفتر الأستاذ العام" subtitle={accountName || "اختر حساباً لعرض حركته"} />

      <Card>
        <CardHeader>
          <CardTitle>تصفية</CardTitle>
          <CardDescription>اختر الحساب والفترة.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-wrap items-end gap-3">
            <div className="space-y-2">
              <Label htmlFor="account">الحساب</Label>
              <select id="account" name="account" defaultValue={accountId} className={`${selectCls} min-w-64`}>
                <option value="">— اختر الحساب —</option>
                {accountList.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.nameAr}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="from">من تاريخ</Label>
              <input id="from" name="from" type="date" defaultValue={from} className={selectCls} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="to">إلى تاريخ</Label>
              <input id="to" name="to" type="date" defaultValue={to} className={selectCls} />
            </div>
            <Button type="submit">عرض</Button>
          </form>
        </CardContent>
      </Card>

      {accountId && (
        <Card>
          <CardHeader>
            <CardTitle>حركة الحساب</CardTitle>
            <CardDescription>الرصيد موجب = مدين، سالب = دائن.</CardDescription>
          </CardHeader>
          <CardContent>
            {rows.length === 0 ? (
              <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">لا توجد حركة في هذه الفترة.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-start">التاريخ</TableHead>
                    <TableHead className="text-start">القيد</TableHead>
                    <TableHead className="text-start">البيان</TableHead>
                    <TableHead className="text-start">مدين</TableHead>
                    <TableHead className="text-start">دائن</TableHead>
                    <TableHead className="text-start">الرصيد</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow className="bg-muted/30">
                    <TableCell colSpan={5} className="font-medium">رصيد افتتاحي</TableCell>
                    <TableCell className="font-medium">{fmt(opening)}</TableCell>
                  </TableRow>
                  {rows.map((r, i) => {
                    running += Number(r.debit) - Number(r.credit);
                    return (
                      <TableRow key={i}>
                        <TableCell>{dt(r.date)}</TableCell>
                        <TableCell className="font-mono">{r.number}</TableCell>
                        <TableCell>{r.description ?? r.reference ?? "—"}</TableCell>
                        <TableCell>{Number(r.debit) ? fmt(Number(r.debit)) : "—"}</TableCell>
                        <TableCell>{Number(r.credit) ? fmt(Number(r.credit)) : "—"}</TableCell>
                        <TableCell>{fmt(running)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
                <TableFooter>
                  <TableRow className="font-bold">
                    <TableCell colSpan={3}>الإجمالي</TableCell>
                    <TableCell>{fmt(totalDebit)}</TableCell>
                    <TableCell>{fmt(totalCredit)}</TableCell>
                    <TableCell>{fmt(running)}</TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
