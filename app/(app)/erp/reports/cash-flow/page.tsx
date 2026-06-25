import { requireErpModule } from "@/lib/erp/org";
import { accountBalances, naturalAmount } from "@/lib/erp/financials";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ErpPageHeader } from "@/components/erp/page-header";
import { ReportTabs } from "@/components/erp/report-tabs";

const fmt   = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2 });
const inp   = "flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm";
const iso   = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Cash-flow category based on account type + code prefix.
 * Typical Arabic CoA: 110x = cash/bank, 11-14xx = current assets,
 * 15-19xx = fixed/non-current, 21-24xx = current liabilities,
 * 25-29xx = LT liabilities, 3xxx = equity.
 */
function category(code: string, type: string): "cash" | "operating" | "investing" | "financing" {
  if (type === "ASSET") {
    if (code.startsWith("110")) return "cash";
    if (code < "15")            return "operating";
    return "investing";
  }
  if (type === "LIABILITY") {
    if (code < "25") return "operating";
    return "financing";
  }
  if (type === "EQUITY") return "financing";
  return "operating";
}

type CashLine = { code: string; nameAr: string; amount: number; sign: 1 | -1 };

export default async function CashFlowPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { orgId } = await requireErpModule("reports.view");
  const sp = await searchParams;

  const now = new Date();
  const from = sp.from || `${now.getFullYear()}-01-01`;
  const to   = sp.to   || iso(now);

  const startDate = new Date(from);
  const endDate   = new Date(`${to}T23:59:59`);

  // Period movements (for income statement P&L and working-capital changes)
  const periodBalances = await accountBalances({ orgId, from: startDate, to: endDate });

  // Beginning cumulative balances (1 day before the period)
  const beginDate = new Date(startDate);
  beginDate.setDate(beginDate.getDate() - 1);
  beginDate.setHours(23, 59, 59);
  const beginBalances = await accountBalances({ orgId, to: beginDate });
  const beginMap = new Map(beginBalances.map((b) => [b.id, b]));

  // ── Net income ────────────────────────────────────────────────
  const periodRev  = periodBalances.filter((b) => b.type === "REVENUE");
  const periodExp  = periodBalances.filter((b) => b.type === "EXPENSE");
  const netRevenue = periodRev.reduce((s, b) => s + naturalAmount(b), 0);
  const netExpense = periodExp.reduce((s, b) => s + naturalAmount(b), 0);
  const netIncome  = netRevenue - netExpense;

  // ── Balance-sheet account changes ────────────────────────────
  const bsAccounts = periodBalances.filter(
    (b) => b.type === "ASSET" || b.type === "LIABILITY" || b.type === "EQUITY",
  );

  const operating: CashLine[] = [];
  const investing: CashLine[] = [];
  const financing: CashLine[] = [];

  for (const b of bsAccounts) {
    const cat = category(b.code, b.type);
    if (cat === "cash") continue; // shown separately

    // Change in this account within the period (debit-credit net)
    const periodChange = b.balance; // debit - credit for the period

    // Cash impact:
    // ASSET increase (positive balance) = uses cash → negative
    // LIABILITY/EQUITY increase (negative balance = more credit) = provides cash → positive
    // Both cases: cash_impact = -periodChange
    const cashImpact = -periodChange;
    if (cashImpact === 0) continue;

    const line: CashLine = {
      code: b.code,
      nameAr: b.nameAr,
      amount: Math.abs(cashImpact),
      sign: cashImpact > 0 ? 1 : -1,
    };

    if (cat === "operating") operating.push(line);
    else if (cat === "investing") investing.push(line);
    else financing.push(line);
  }

  // Sort each section by code
  const sortLines = (arr: CashLine[]) => arr.sort((a, b) => a.code.localeCompare(b.code));
  sortLines(operating); sortLines(investing); sortLines(financing);

  const sumLines = (arr: CashLine[]) => arr.reduce((s, l) => s + l.sign * l.amount, 0);
  const opTotal  = sumLines(operating) + netIncome;
  const invTotal = sumLines(investing);
  const finTotal = sumLines(financing);
  const netCashChange = opTotal + invTotal + finTotal;

  // Cash beginning and ending
  const cashBegin = beginBalances
    .filter((b) => b.type === "ASSET" && b.code.startsWith("110"))
    .reduce((s, b) => s + naturalAmount(b), 0);
  const cashEnd = cashBegin + netCashChange;

  return (
    <div className="space-y-6">
      <ErpPageHeader icon="ArrowLeftRight" title="التدفق النقدي" subtitle={`من ${from} إلى ${to} — الطريقة غير المباشرة`} />
      <ReportTabs active="/erp/reports/cash-flow" />

      {/* Date filter */}
      <Card>
        <CardContent className="pt-5">
          <form className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="from">من تاريخ</Label>
              <input id="from" name="from" type="date" defaultValue={from} className={inp} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="to">إلى تاريخ</Label>
              <input id="to" name="to" type="date" defaultValue={to} className={inp} />
            </div>
            <Button type="submit">عرض</Button>
          </form>
        </CardContent>
      </Card>

      {/* Operating */}
      <CashSection title="الأنشطة التشغيلية" total={opTotal}>
        <CashRow label="صافي الربح / (الخسارة)" amount={netIncome} />
        <SubLabel>التغيرات في رأس المال العامل</SubLabel>
        {operating.map((l) => <CashRow key={l.code} label={`${l.code} — ${l.nameAr}`} amount={l.sign * l.amount} />)}
      </CashSection>

      {/* Investing */}
      <CashSection title="الأنشطة الاستثمارية" total={invTotal}>
        {investing.length === 0
          ? <p className="text-sm text-muted-foreground">لا توجد أنشطة استثمارية في الفترة.</p>
          : investing.map((l) => <CashRow key={l.code} label={`${l.code} — ${l.nameAr}`} amount={l.sign * l.amount} />)}
      </CashSection>

      {/* Financing */}
      <CashSection title="الأنشطة التمويلية" total={finTotal}>
        {financing.length === 0
          ? <p className="text-sm text-muted-foreground">لا توجد أنشطة تمويلية في الفترة.</p>
          : financing.map((l) => <CashRow key={l.code} label={`${l.code} — ${l.nameAr}`} amount={l.sign * l.amount} />)}
      </CashSection>

      {/* Summary */}
      <Card>
        <CardContent className="pt-5 space-y-3">
          <div className="flex justify-between border-b pb-2 text-sm">
            <span>صافي التغير في النقدية</span>
            <span className={`font-semibold tabular-nums ${netCashChange >= 0 ? "text-emerald-600" : "text-destructive"}`}>
              {netCashChange >= 0 ? "+" : ""}{fmt(netCashChange)}
            </span>
          </div>
          <div className="flex justify-between text-sm text-muted-foreground">
            <span>رصيد النقدية أول الفترة</span>
            <span className="tabular-nums">{fmt(cashBegin)}</span>
          </div>
          <div className="flex justify-between font-bold">
            <span>رصيد النقدية آخر الفترة</span>
            <span className="tabular-nums text-lg">{fmt(cashEnd)}</span>
          </div>
          <p className="text-xs text-muted-foreground">
            * النقدية تشمل حسابات الكود 110x فقط. الطريقة غير المباشرة — التغيرات مستخرجة من قيود الأستاذ العام.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function CashSection({
  title,
  total,
  children,
}: {
  title: string;
  total: number;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        {children}
        <div className="mt-3 flex justify-between border-t pt-2 font-semibold">
          <span>صافي {title}</span>
          <span className={`tabular-nums ${total >= 0 ? "text-emerald-600" : "text-destructive"}`}>
            {total >= 0 ? "+" : ""}{(total < 0 ? "(" + `${(-total).toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2 })}` + ")" : total.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2 }))}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function CashRow({ label, amount }: { label: string; amount: number }) {
  return (
    <div className="flex items-center justify-between py-0.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={`tabular-nums ${amount < 0 ? "text-destructive" : ""}`}>
        {amount >= 0 ? fmt(amount) : `(${fmt(-amount)})`}
      </span>
    </div>
  );
}

function SubLabel({ children }: { children: React.ReactNode }) {
  return <p className="mt-2 text-xs font-medium text-muted-foreground">{children}</p>;
}
