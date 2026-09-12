import { and, eq, sql } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { accounts, journalEntries, salesInvoices, purchaseInvoices } from "@/db/schema";
import { accountBalances, naturalAmount } from "@/lib/erp/financials";
import { resolveAccountCodes } from "@/lib/erp/accounting-config";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ErpPageHeader } from "@/components/erp/page-header";
import { ModuleWorkspace } from "@/components/erp/module-workspace";
import { AcademyLink } from "@/components/erp/academy-link";
import { NeedsAttention } from "@/components/erp/needs-attention";
import { Icon } from "@/components/icon";
import { cn } from "@/lib/utils";

const money = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default async function AccountingDashboardPage() {
  return loadErpPage("accounting.view", async ({ orgId, permissions }) => {
    const [balances, [acc], [je], [si], [pi], [jeDraft], [siDraft], [piDraft]] = await Promise.all([
      accountBalances({ orgId }),
      db.select({ n: sql<number>`count(*)` }).from(accounts).where(eq(accounts.organizationId, orgId)),
      db.select({ n: sql<number>`count(*)` }).from(journalEntries).where(eq(journalEntries.organizationId, orgId)),
      db.select({ n: sql<number>`count(*)` }).from(salesInvoices).where(and(eq(salesInvoices.organizationId, orgId))),
      db.select({ n: sql<number>`count(*)` }).from(purchaseInvoices).where(and(eq(purchaseInvoices.organizationId, orgId))),
      db.select({ n: sql<number>`count(*)` }).from(journalEntries).where(and(eq(journalEntries.organizationId, orgId), eq(journalEntries.status, "DRAFT"))),
      db.select({ n: sql<number>`count(*)` }).from(salesInvoices).where(and(eq(salesInvoices.organizationId, orgId), eq(salesInvoices.status, "DRAFT"))),
      db.select({ n: sql<number>`count(*)` }).from(purchaseInvoices).where(and(eq(purchaseInvoices.organizationId, orgId), eq(purchaseInvoices.status, "DRAFT"))),
    ]);

    // Odoo-style "needs attention": draft documents awaiting posting.
    const todos = [
      { label: "قيود غير مُرحّلة", hint: "بانتظار الترحيل", count: Number(jeDraft.n), href: "/accounting/journal", icon: "BookText" },
      { label: "فواتير بيع مسودة", hint: "بانتظار الترحيل", count: Number(siDraft.n), href: "/sales/invoices", icon: "ReceiptText" },
      { label: "فواتير شراء مسودة", hint: "بانتظار الترحيل", count: Number(piDraft.n), href: "/purchases/invoices", icon: "ReceiptText" },
    ];

    const income = balances.filter((b) => b.type === "REVENUE").reduce((s, b) => s + naturalAmount(b), 0);
    const expense = balances.filter((b) => b.type === "EXPENSE").reduce((s, b) => s + naturalAmount(b), 0);
    const net = income - expense;
    const byCode = Object.fromEntries(balances.map((b) => [b.code, b.balance]));
    const rc = await resolveAccountCodes(orgId, ["1101", "1102", "1103", "2101"]);
    const ar = byCode[rc["1103"]] ?? 0;
    const ap = -(byCode[rc["2101"]] ?? 0);
    const cash = (byCode[rc["1101"]] ?? 0) + (byCode[rc["1102"]] ?? 0);
    const assets = balances.filter((b) => b.type === "ASSET").reduce((s, b) => s + naturalAmount(b), 0);

    const counts: Record<string, number> = { "/accounting/chart": Number(acc.n), "/accounting/journal": Number(je.n), "/sales/invoices": Number(si.n), "/purchases/invoices": Number(pi.n) };

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
        <ErpPageHeader icon="Calculator" title="المحاسبة" subtitle="نظرة عامة على الأداء المالي"
          action={<AcademyLink module="accounting" />} />

        <NeedsAttention tiles={todos} />

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
        {/* Every page in this module, straight from the sidebar config — see
            ModuleWorkspace for why this is derived and not another hand-kept list. */}
        <ModuleWorkspace heading="المحاسبة" permissions={permissions} counts={counts}
          actions={[{ label: "قيد يومية جديد", href: "/accounting/journal/new", icon: "Plus" }, { label: "مصروف جديد", href: "/accounting/expenses/new", icon: "Plus" }]} />
      </div>
    );
  });
}
