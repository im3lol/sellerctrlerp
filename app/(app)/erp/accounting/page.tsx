import Link from "next/link";
import { and, eq, sql } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { accounts, journalEntries, salesInvoices, purchaseInvoices } from "@/db/schema";
import { accountBalances, naturalAmount } from "@/lib/erp/financials";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ErpPageHeader } from "@/components/erp/page-header";
import { Icon } from "@/components/icon";
import { cn } from "@/lib/utils";

const money = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const intf = (n: number) => n.toLocaleString("ar-EG-u-nu-latn");

const SHORTCUTS = [
  { label: "دليل الحسابات", href: "/erp/accounting/chart", icon: "Calculator", key: "accounts" },
  { label: "القيود اليومية", href: "/erp/accounting/journal", icon: "BookText", key: "journal" },
  { label: "قيد جديد", href: "/erp/accounting/journal/new", icon: "Plus" },
  { label: "دفتر الأستاذ", href: "/erp/accounting/ledger", icon: "BookOpen" },
  { label: "ميزان المراجعة", href: "/erp/reports", icon: "ChartPie" },
  { label: "قائمة الدخل", href: "/erp/reports/income-statement", icon: "TrendingUp" },
  { label: "الميزانية العمومية", href: "/erp/reports/balance-sheet", icon: "Scale" },
  { label: "مراكز التكلفة", href: "/erp/accounting/cost-centers", icon: "Target" },
  { label: "الفترات المالية", href: "/erp/accounting/periods", icon: "Lock" },
  { label: "فواتير البيع", href: "/erp/sales/invoices", icon: "ReceiptText", key: "sales" },
  { label: "فواتير الشراء", href: "/erp/purchases/invoices", icon: "ReceiptText", key: "purchases" },
  { label: "سندات القبض", href: "/erp/sales/receipts", icon: "HandCoins" },
  { label: "سندات الصرف", href: "/erp/purchases/payments", icon: "Banknote" },
] as const;

export default async function AccountingDashboardPage() {
  const { orgId } = await requireErpModule("accounting.view");

  const [balances, [acc], [je], [si], [pi]] = await Promise.all([
    accountBalances({ orgId }),
    db.select({ n: sql<number>`count(*)` }).from(accounts).where(eq(accounts.organizationId, orgId)),
    db.select({ n: sql<number>`count(*)` }).from(journalEntries).where(eq(journalEntries.organizationId, orgId)),
    db.select({ n: sql<number>`count(*)` }).from(salesInvoices).where(and(eq(salesInvoices.organizationId, orgId))),
    db.select({ n: sql<number>`count(*)` }).from(purchaseInvoices).where(and(eq(purchaseInvoices.organizationId, orgId))),
  ]);

  const income = balances.filter((b) => b.type === "REVENUE").reduce((s, b) => s + naturalAmount(b), 0);
  const expense = balances.filter((b) => b.type === "EXPENSE").reduce((s, b) => s + naturalAmount(b), 0);
  const net = income - expense;
  const byCode = Object.fromEntries(balances.map((b) => [b.code, b.balance]));
  const ar = byCode["1103"] ?? 0;
  const ap = -(byCode["2101"] ?? 0);
  const cash = (byCode["1101"] ?? 0) + (byCode["1102"] ?? 0);
  const assets = balances.filter((b) => b.type === "ASSET").reduce((s, b) => s + naturalAmount(b), 0);

  const counts: Record<string, number> = { accounts: Number(acc.n), journal: Number(je.n), sales: Number(si.n), purchases: Number(pi.n) };

  const max = Math.max(income, expense, Math.abs(net), 1);
  const bars = [
    { label: "الإيرادات", value: income, color: "bg-rose-400" },
    { label: "المصروفات", value: expense, color: "bg-blue-500" },
    { label: "صافي الربح", value: net, color: net >= 0 ? "bg-emerald-500" : "bg-destructive" },
  ];

  const kpis = [
    { label: "صافي الربح/الخسارة", value: net, tone: net >= 0 ? "text-emerald-600" : "text-destructive", icon: "TrendingUp" },
    { label: "إجمالي الإيرادات", value: income, tone: "text-foreground", icon: "ArrowDownLeft" },
    { label: "إجمالي المصروفات", value: expense, tone: "text-foreground", icon: "ArrowUpRight" },
    { label: "الذمم المدينة (عملاء)", value: ar, tone: "text-foreground", icon: "Users" },
    { label: "الذمم الدائنة (موردون)", value: ap, tone: "text-foreground", icon: "Truck" },
    { label: "النقدية والبنوك", value: cash, tone: "text-foreground", icon: "Wallet" },
  ];

  return (
    <div className="space-y-6">
      <ErpPageHeader icon="Calculator" title="المحاسبة" subtitle="نظرة عامة على الأداء المالي" />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Profit & Loss chart */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>الأرباح والخسائر</CardTitle>
            <CardDescription>الإيرادات مقابل المصروفات وصافي الربح (من القيود المُرحّلة).</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex h-56 items-end justify-around gap-6 border-b pb-2">
              {bars.map((b) => (
                <div key={b.label} className="flex h-full flex-1 flex-col items-center justify-end gap-2">
                  <span className="text-sm font-semibold tabular-nums">{money(b.value)}</span>
                  <div
                    className={cn("w-full max-w-28 rounded-t-md", b.color)}
                    style={{ height: `${Math.max((Math.abs(b.value) / max) * 100, 2)}%` }}
                  />
                </div>
              ))}
            </div>
            <div className="mt-3 flex justify-around text-sm text-muted-foreground">
              {bars.map((b) => <span key={b.label}>{b.label}</span>)}
            </div>
          </CardContent>
        </Card>

        {/* Net summary card */}
        <Card className="flex flex-col justify-center">
          <CardContent className="space-y-4 py-8 text-center">
            <div className="text-sm text-muted-foreground">صافي الربح / الخسارة</div>
            <div className={cn("text-4xl font-bold tabular-nums", net >= 0 ? "text-emerald-600" : "text-destructive")}>{money(net)}</div>
            <div className="flex justify-center gap-6 pt-2 text-sm">
              <div><div className="text-muted-foreground">إجمالي الأصول</div><div className="font-semibold tabular-nums">{money(assets)}</div></div>
              <div><div className="text-muted-foreground">النقدية</div><div className="font-semibold tabular-nums">{money(cash)}</div></div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* KPI cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {kpis.map((k) => (
          <Card key={k.label}>
            <CardContent className="flex items-center justify-between py-5">
              <div>
                <div className="text-sm text-muted-foreground">{k.label}</div>
                <div className={cn("mt-1 text-2xl font-bold tabular-nums", k.tone)}>{money(k.value)}</div>
              </div>
              <div className="flex size-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <Icon name={k.icon} className="size-5" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Shortcuts */}
      <Card>
        <CardHeader>
          <CardTitle>اختصارات</CardTitle>
          <CardDescription>الوصول السريع لشاشات المحاسبة.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {SHORTCUTS.map((s) => (
              <Link
                key={s.href}
                href={s.href}
                className="group flex items-center gap-3 rounded-xl border bg-card px-4 py-3 transition-colors hover:border-primary hover:bg-accent"
              >
                <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground">
                  <Icon name={s.icon} className="size-4" />
                </div>
                <span className="flex-1 text-sm font-medium">{s.label}</span>
                {"key" in s && s.key && counts[s.key] != null && (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground tabular-nums">{intf(counts[s.key])}</span>
                )}
              </Link>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
