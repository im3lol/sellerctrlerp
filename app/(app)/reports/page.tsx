import { loadErpPage } from "@/lib/erp/org";
import { accountBalances } from "@/lib/erp/financials";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Icon } from "@/components/icon";
import { ErpPageHeader } from "@/components/erp/page-header";
import { ReportTabs } from "@/components/erp/report-tabs";
import { ReportToolbar } from "@/components/erp/report-toolbar";
import { selectCls } from "@/lib/utils";

const fmt = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const iso = (d: Date) => d.toISOString().slice(0, 10);

export default async function ErpReportsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  return loadErpPage("reports.view", async ({ orgId }) => {
    const sp = await searchParams;
    const now = new Date();
    const from = sp.from || `${now.getFullYear()}-01-01`;
    const to = sp.to || iso(now);

    const balances = await accountBalances({ orgId, from: new Date(from), to: new Date(`${to}T23:59:59`) });
    const lines = balances
      .filter((b) => b.debit !== 0 || b.credit !== 0)
      .map((b) => ({ id: b.id, code: b.code, nameAr: b.nameAr, debit: b.balance > 0 ? b.balance : 0, credit: b.balance < 0 ? -b.balance : 0 }));
    const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
    const totalCredit = lines.reduce((s, l) => s + l.credit, 0);
    const balanced = Math.abs(totalDebit - totalCredit) < 0.01;

    return (
      <div className="space-y-6">
        <ErpPageHeader
          icon="BarChart3"
          title="التقارير المالية — ميزان المراجعة"
          subtitle={`من ${from} إلى ${to} — من القيود المُرحّلة`}
          action={
            <ReportToolbar excel={`/api/erp/reports/trial-balance/export?${new URLSearchParams({ from, to }).toString()}`} />
          }
        />
        <ReportTabs active="/reports" />

        <Card>
          <CardHeader>
            <CardTitle>الفترة</CardTitle>
            <CardDescription>اختر فترة ميزان المراجعة.</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="flex flex-wrap items-end gap-3">
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
                لا توجد قيود مُرحّلة في هذه الفترة.
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
                      <TableCell className="font-mono">
                        <a href={`/accounting/ledger?${new URLSearchParams({ account: l.id, from, to }).toString()}`} className="hover:text-primary hover:underline">{l.code}</a>
                      </TableCell>
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
  });
}
