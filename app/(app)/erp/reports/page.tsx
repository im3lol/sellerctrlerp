import { and, asc, eq, sql } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { accounts, journalEntries, journalEntryLines } from "@/db/schema";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ErpPageHeader } from "@/components/erp/page-header";
import { ReportTabs } from "@/components/erp/report-tabs";

const fmt = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default async function ErpReportsPage() {
  const { orgId } = await requireErpModule("reports.view");

  const rows = await db
    .select({
      code: accounts.code,
      nameAr: accounts.nameAr,
      debit: sql<string>`coalesce(sum(${journalEntryLines.debit}), 0)`,
      credit: sql<string>`coalesce(sum(${journalEntryLines.credit}), 0)`,
    })
    .from(journalEntryLines)
    .innerJoin(
      journalEntries,
      and(
        eq(journalEntries.id, journalEntryLines.journalEntryId),
        eq(journalEntries.organizationId, orgId),
        eq(journalEntries.status, "POSTED"),
      ),
    )
    .innerJoin(accounts, eq(accounts.id, journalEntryLines.accountId))
    .groupBy(accounts.id)
    .orderBy(asc(accounts.code));

  const lines = rows.map((r) => {
    const bal = Number(r.debit) - Number(r.credit);
    return { code: r.code, nameAr: r.nameAr, debit: bal > 0 ? bal : 0, credit: bal < 0 ? -bal : 0 };
  });
  const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
  const totalCredit = lines.reduce((s, l) => s + l.credit, 0);
  const balanced = Math.abs(totalDebit - totalCredit) < 0.01;

  return (
    <div className="space-y-6">
      <ErpPageHeader icon="BarChart3" title="التقارير المالية — ميزان المراجعة" subtitle="من القيود المُرحّلة" />
      <ReportTabs active="/erp/reports" />
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle>ميزان المراجعة</CardTitle>
            <CardDescription>أرصدة الحسابات من واقع القيود المُرحّلة للمؤسسة النشطة.</CardDescription>
          </div>
          <Badge variant={balanced ? "default" : "destructive"}>{balanced ? "متوازن" : "غير متوازن"}</Badge>
        </CardHeader>
        <CardContent>
          {lines.length === 0 ? (
            <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">
              لا توجد قيود مُرحّلة بعد — رحّل فاتورة لرؤية الأرصدة.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-start">الكود</TableHead>
                  <TableHead className="text-start">الحساب</TableHead>
                  <TableHead className="text-start">مدين</TableHead>
                  <TableHead className="text-start">دائن</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((l) => (
                  <TableRow key={l.code}>
                    <TableCell className="font-mono">{l.code}</TableCell>
                    <TableCell>{l.nameAr}</TableCell>
                    <TableCell>{l.debit ? fmt(l.debit) : "—"}</TableCell>
                    <TableCell>{l.credit ? fmt(l.credit) : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow className="font-bold">
                  <TableCell colSpan={2}>الإجمالي</TableCell>
                  <TableCell>{fmt(totalDebit)}</TableCell>
                  <TableCell>{fmt(totalCredit)}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
