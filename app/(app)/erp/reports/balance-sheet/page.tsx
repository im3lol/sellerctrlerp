import { requireErpModule } from "@/lib/erp/org";
import { accountBalances, naturalAmount, type AccountBalance } from "@/lib/erp/financials";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ErpPageHeader } from "@/components/erp/page-header";
import { ReportTabs } from "@/components/erp/report-tabs";

const fmt = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const selectCls = "flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm";
const iso = (d: Date) => d.toISOString().slice(0, 10);

export default async function BalanceSheetPage({
  searchParams,
}: {
  searchParams: Promise<{ to?: string }>;
}) {
  const { orgId } = await requireErpModule("reports.view");
  const sp = await searchParams;
  const to = sp.to || iso(new Date());

  // As-of: all POSTED movements up to and including `to`.
  const balances = await accountBalances({ orgId, to: new Date(`${to}T23:59:59`) });

  const pick = (type: string) =>
    balances
      .filter((b) => b.type === type)
      .map((b) => ({ ...b, amount: naturalAmount(b) }))
      .filter((b) => b.amount !== 0);

  const assets = pick("ASSET");
  const liabilities = pick("LIABILITY");
  const equity = pick("EQUITY");

  const totalAssets = assets.reduce((s, b) => s + b.amount, 0);
  const totalLiabilities = liabilities.reduce((s, b) => s + b.amount, 0);
  const totalEquityAccounts = equity.reduce((s, b) => s + b.amount, 0);

  // Retained result for the period = cumulative revenue − expense up to `to`.
  const netIncome =
    balances.filter((b) => b.type === "REVENUE").reduce((s, b) => s + naturalAmount(b), 0) -
    balances.filter((b) => b.type === "EXPENSE").reduce((s, b) => s + naturalAmount(b), 0);

  const totalEquity = totalEquityAccounts + netIncome;
  const totalLiabEquity = totalLiabilities + totalEquity;
  const balanced = Math.abs(totalAssets - totalLiabEquity) < 0.01;

  return (
    <div className="space-y-6">
      <ErpPageHeader icon="Scale" title="الميزانية العمومية" subtitle={`كما في ${to} — من القيود المُرحّلة`} />
      <ReportTabs active="/erp/reports/balance-sheet" />

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle>التاريخ</CardTitle>
            <CardDescription>أرصدة الحسابات حتى تاريخ محدّد.</CardDescription>
          </div>
          <Badge variant={balanced ? "default" : "destructive"}>{balanced ? "متوازنة" : "غير متوازنة"}</Badge>
        </CardHeader>
        <CardContent>
          <form className="flex flex-wrap items-end gap-3">
            <div className="space-y-2">
              <Label htmlFor="to">كما في تاريخ</Label>
              <input id="to" name="to" type="date" defaultValue={to} className={selectCls} />
            </div>
            <Button type="submit">عرض</Button>
          </form>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>الأصول</CardTitle>
            <CardDescription>إجمالي {fmt(totalAssets)}</CardDescription>
          </CardHeader>
          <CardContent>
            <BsTable rows={assets} empty="لا توجد أصول." totalLabel="إجمالي الأصول" total={totalAssets} />
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>الخصوم</CardTitle>
              <CardDescription>إجمالي {fmt(totalLiabilities)}</CardDescription>
            </CardHeader>
            <CardContent>
              <BsTable rows={liabilities} empty="لا توجد خصوم." totalLabel="إجمالي الخصوم" total={totalLiabilities} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>حقوق الملكية</CardTitle>
              <CardDescription>إجمالي {fmt(totalEquity)}</CardDescription>
            </CardHeader>
            <CardContent>
              <BsTable
                rows={equity}
                empty="لا توجد حسابات حقوق ملكية."
                extra={{ label: "صافي ربح/خسارة الفترة", amount: netIncome }}
                totalLabel="إجمالي حقوق الملكية"
                total={totalEquity}
              />
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex items-center justify-between py-5">
              <div className="font-semibold">إجمالي الخصوم وحقوق الملكية</div>
              <span className="text-xl font-bold">{fmt(totalLiabEquity)}</span>
            </CardContent>
          </Card>
        </div>
      </div>

      {!balanced && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          فرق غير متوازن: {fmt(totalAssets - totalLiabEquity)} — راجع القيود غير المتوازنة أو الحسابات غير المصنّفة.
        </div>
      )}
    </div>
  );
}

type Row = Pick<AccountBalance, "code" | "nameAr"> & { amount: number };

function BsTable({
  rows,
  empty,
  totalLabel,
  total,
  extra,
}: {
  rows: Row[];
  empty: string;
  totalLabel: string;
  total: number;
  extra?: { label: string; amount: number };
}) {
  if (rows.length === 0 && !extra) {
    return <div className="rounded-xl border border-dashed py-10 text-center text-muted-foreground">{empty}</div>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="text-start">الكود</TableHead>
          <TableHead className="text-start">الحساب</TableHead>
          <TableHead className="text-start">المبلغ</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.code}>
            <TableCell className="font-mono">{r.code}</TableCell>
            <TableCell>{r.nameAr}</TableCell>
            <TableCell>{fmt(r.amount)}</TableCell>
          </TableRow>
        ))}
        {extra && (
          <TableRow>
            <TableCell className="font-mono">—</TableCell>
            <TableCell>{extra.label}</TableCell>
            <TableCell>{fmt(extra.amount)}</TableCell>
          </TableRow>
        )}
        <TableRow className="font-bold">
          <TableCell colSpan={2}>{totalLabel}</TableCell>
          <TableCell>{fmt(total)}</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );
}
