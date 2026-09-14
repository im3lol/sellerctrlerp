import Link from "next/link";
import { requireUser } from "@/lib/session";
import { getActiveOrg } from "@/lib/erp/org";
import { getEnabledModules } from "@/lib/erp/entitlements";
import { getSubscriptionState } from "@/lib/erp/subscription";
import { getErpOverview, getPendingWork, getSalesTrend, getDashboardInsights } from "@/lib/erp/overview";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { NeedsAttention, type AttentionTile } from "@/components/erp/needs-attention";
import { SetupProgressCard } from "@/components/erp/setup-progress-card";
import { SubscriptionBanner } from "@/components/erp/subscription-banner";
import { getSetupStatus } from "@/lib/erp/setup-status";
import { TrendChart } from "@/components/charts/trend-chart";
import { GroupedBarChart } from "@/components/charts/grouped-bar-chart";
import { Icon } from "@/components/icon";
import { getMemberAccess } from "@/lib/erp/auth-guard";
import { withOrgScope } from "@/lib/db-scope";
import { countPendingApprovals } from "@/lib/erp/approvals";
import { listStuckDocs } from "@/lib/erp/stuck-docs";
import { getReorderPlan } from "@/lib/erp/reorder-data";
import type { ErpPermission } from "@/lib/erp/permissions";
import { cn } from "@/lib/utils";

const money = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const intl = (n: number) => n.toLocaleString("ar-EG-u-nu-latn");
const pct = (n: number) => `${n.toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 1 })}٪`;
const shortDate = (d: Date) => new Date(d).toLocaleDateString("ar-EG-u-nu-latn", { day: "numeric", month: "short" });
const CHANNEL: Record<string, string> = { AMAZON: "أمازون", NOON: "نون", MANUAL: "مبيعات مباشرة" };

/** The everyday documents, one click away — each only for someone who may create it. */
const SHORTCUTS: { label: string; href: string; icon: string; perm: ErpPermission }[] = [
  { label: "أمر بيع", href: "/sales/orders/new", icon: "ClipboardList", perm: "sales.create" },
  { label: "فاتورة بيع", href: "/sales/invoices/new", icon: "ReceiptText", perm: "sales.create" },
  { label: "سند قبض", href: "/sales/receipts/new", icon: "HandCoins", perm: "sales.collect" },
  { label: "أمر شراء", href: "/purchases/orders/new", icon: "ShoppingBag", perm: "purchases.create" },
  { label: "إذن استلام", href: "/purchases/receipts/new", icon: "PackageCheck", perm: "purchases.receive" },
  { label: "سند صرف", href: "/purchases/payments/new", icon: "Wallet", perm: "purchases.pay" },
  { label: "مصروف", href: "/accounting/expenses/new", icon: "Banknote", perm: "accounting.create" },
  { label: "قيد يومية", href: "/accounting/journal/new", icon: "BookText", perm: "accounting.create" },
  { label: "تسوية مخزون", href: "/inventory/adjustments/new", icon: "ClipboardCheck", perm: "inventory.create" },
  { label: "صنف جديد", href: "/inventory/items/new", icon: "PackagePlus", perm: "inventory.create" },
];

type Tone = "up" | "down" | "warn";
const TONE: Record<Tone, string> = {
  up: "text-emerald-600 dark:text-emerald-400",
  down: "text-red-600 dark:text-red-400",
  warn: "text-amber-600 dark:text-amber-400",
};
type Stat = { label: string; value: string; note?: string; tone?: Tone; href: string };

function StatCard({ s }: { s: Stat }) {
  return (
    <Link href={s.href}>
      <Card className="h-full transition-colors hover:border-primary/50">
        <CardContent className="pt-6">
          <div className="text-xs text-muted-foreground">{s.label}</div>
          <div className="mt-1 text-xl font-bold tabular-nums">{s.value}</div>
          {s.note && <div className={cn("mt-1 text-xs text-muted-foreground", s.tone && TONE[s.tone])}>{s.note}</div>}
        </CardContent>
      </Card>
    </Link>
  );
}

/** A small figure inside a card — the marketplace and stock-health grids. */
function MiniStat({ s }: { s: Stat }) {
  return (
    <Link href={s.href} className="rounded-xl border p-3 transition-colors hover:border-primary/50 hover:bg-accent/40">
      <div className="text-xs text-muted-foreground">{s.label}</div>
      <div className={cn("mt-1 text-lg font-bold tabular-nums", s.tone && TONE[s.tone])}>{s.value}</div>
      {s.note && <div className="text-xs text-muted-foreground">{s.note}</div>}
    </Link>
  );
}

/** A ranked list with a proportion bar. One hue on purpose: the bar shows size, not identity. */
function RankList({ rows, empty }: { rows: { label: string; value: number; sub?: string }[]; empty: string }) {
  const max = Math.max(0, ...rows.map((r) => r.value));
  if (!rows.length || max <= 0) return <p className="py-6 text-center text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="space-y-3">
      {rows.map((r, i) => (
        <li key={i} className="space-y-1">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate" title={r.label}>{r.label}</span>
            <span className="shrink-0 font-medium tabular-nums">{money(r.value)}</span>
          </div>
          <div className="h-1.5 rounded-full bg-muted">
            <div className="h-1.5 rounded-full bg-primary/70" style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }} />
          </div>
          {r.sub && <div className="text-xs text-muted-foreground">{r.sub}</div>}
        </li>
      ))}
    </ul>
  );
}

const Section = ({ title }: { title: string }) => <h2 className="mb-3 text-sm font-semibold text-muted-foreground">{title}</h2>;

/**
 * The business at a glance: what needs doing, how this month is going against the last,
 * where the money is, what's selling, the platforms, and stock health.
 *
 * Every block is behind the permission that owns its numbers — a storekeeper sees stock,
 * not profit — and every load is fail-safe and runs in parallel: one slow query must
 * neither blank the page nor hold the rest back.
 */
export default async function DashboardPage() {
  const user = await requireUser();
  const { org } = await getActiveOrg();
  const [enabled, access, sub] = await Promise.all([
    user.role === "system_admin" || !org ? null : getEnabledModules(org.id),
    org ? getMemberAccess(org.id, user) : null,
    org && user.role !== "system_admin" ? getSubscriptionState(org.id) : null,
  ]);
  const perms = access?.permissions ?? new Set<string>();
  const can = (p: ErpPermission) => perms.has(p);
  const seeMoney = can("accounting.view");
  const seeSales = can("sales.view");
  const seePurch = can("purchases.view");
  const seeStock = can("inventory.view");
  const hasMkt = !enabled || enabled.has("marketplace");

  const safe = <T,>(p: Promise<T>, fallback: T) => p.catch(() => fallback);
  const noInbox = { approvals: 0, stuck: 0 };
  const [ovRes, pending, salesTrend, setup, inbox, ins, plan] = await Promise.all([
    // Remember that the overview FAILED, not just that it's null — null used to read as
    // "brand-new org", so one failed query sent an established seller to getting-started.
    org ? getErpOverview(org.id).then((v) => ({ v, failed: false }), () => ({ v: null, failed: true })) : { v: null, failed: false },
    org ? safe(getPendingWork(org.id), null) : null,
    org && seeSales ? safe(getSalesTrend(org.id, 30), []) : [],
    org && user.role !== "system_admin" ? safe(getSetupStatus(org.id), null) : null,
    org ? safe(withOrgScope(org.id, false, async () => ({
      approvals: can("approvals.decide") ? await countPendingApprovals(org.id) : 0,
      stuck: (await listStuckDocs(org.id, can)).length,
    })), noInbox) : noInbox,
    org ? safe(getDashboardInsights(org.id), null) : null,
    org && seeStock ? safe(withOrgScope(org.id, false, () => getReorderPlan(org.id, { windowDays: 30, leadDays: 14, coverDays: 60 })), []) : [],
  ]);
  const ov = ovRes.v;

  const shortcuts = SHORTCUTS.filter((s) => can(s.perm));

  const pendingTiles: AttentionTile[] = [
    { label: "مستني موافقتك", hint: "الموافقات", count: inbox.approvals, href: "/approvals", icon: "ClipboardCheck" },
    { label: "مستندات واقفة محدش حرّكها", hint: "الموافقات", count: inbox.stuck, href: "/approvals?tab=late", icon: "Clock" },
    ...(pending && seeMoney ? [{ label: "قيود غير مُرحّلة", hint: "المحاسبة", count: pending.jeDraft, href: "/accounting/journal", icon: "BookText" }] : []),
    ...(pending && seeSales ? [
      { label: "فواتير بيع مسودة", hint: "المبيعات", count: pending.siDraft, href: "/sales/invoices", icon: "ReceiptText" },
      { label: "أوامر بيع بانتظار الشحن", hint: "المبيعات", count: pending.soAwaiting, href: "/sales/orders", icon: "ClipboardList" },
    ] : []),
    ...(pending && seePurch ? [
      { label: "فواتير شراء مسودة", hint: "المشتريات", count: pending.piDraft, href: "/purchases/invoices", icon: "ReceiptText" },
      { label: "أوامر شراء بانتظار الاستلام", hint: "المشتريات", count: pending.poAwaiting, href: "/purchases/orders", icon: "PackageCheck" },
    ] : []),
    ...(ins && seeSales && hasMkt ? [{ label: "مرتجعات منصات مستنية قرارك", hint: "المنصات", count: ins.pendingReturns, href: "/sales/marketplace-returns", icon: "Undo2" }] : []),
  ];

  // This month against the same number of days last month, and what it earned.
  const growth = ins && ins.salesPrev > 0 ? ((ins.salesMtd - ins.salesPrev) / ins.salesPrev) * 100 : null;
  const orders = ins ? ins.channels.reduce((s, c) => s + c.orders, 0) : 0;
  const gross = ins ? ins.netSalesMtd - ins.cogsMtd : 0;
  const margin = ins && ins.netSalesMtd > 0 ? (gross / ins.netSalesMtd) * 100 : null;
  const [lastMonth, thisMonth] = ov ? ov.pnlTrend.slice(-2) : [];
  const netMonth = thisMonth ? thisMonth.revenue - thisMonth.expense : 0;

  const kpis: Stat[] = [
    ...(seeSales && ins ? [
      {
        label: "مبيعات الشهر", value: money(ins.salesMtd), href: "/sales/invoices",
        note: growth == null ? `${intl(ins.invoicesMtd)} فاتورة` : `${growth >= 0 ? "▲" : "▼"} ${pct(Math.abs(growth))} عن نفس الأيام الشهر اللي فات`,
        tone: growth == null ? undefined : growth >= 0 ? "up" as const : "down" as const,
      },
      { label: "طلبات الشهر", value: intl(orders), href: "/sales/orders", note: ins.invoicesMtd > 0 ? `متوسط الفاتورة ${money(ins.salesMtd / ins.invoicesMtd)}` : "لسه مفيش فواتير" },
    ] : []),
    ...(seeMoney && ins ? [{
      label: "مجمل الربح", value: money(gross), href: "/sales/reports/profitability",
      note: margin == null ? "بعد تكلفة البضاعة المباعة" : `هامش ${pct(margin)} من المبيعات قبل الضريبة`,
      tone: gross < 0 ? "down" as const : undefined,
    }] : []),
    ...(seeMoney && ov ? [
      {
        label: "صافي ربح الشهر", value: money(netMonth), href: "/reports/income-statement",
        note: lastMonth ? `الشهر اللي فات ${money(lastMonth.revenue - lastMonth.expense)}` : undefined,
        tone: netMonth < 0 ? "down" as const : undefined,
      },
      { label: "النقدية والبنك", value: money(ov.cash), href: "/accounting/ledger", note: ins ? `دخل ${money(ins.cashIn)} · خرج ${money(ins.cashOut)} الشهر ده` : undefined },
    ] : []),
    ...((seeSales || seeMoney) && ov ? [{
      label: "مستحق من العملاء", value: money(ov.ar), href: "/sales/aging",
      note: ov.overdueAR > 0 ? `متأخر ${money(ov.overdueAR)}` : "مفيش متأخرات", tone: ov.overdueAR > 0 ? "warn" as const : undefined,
    }] : []),
    ...((seePurch || seeMoney) && ov ? [{
      label: "مستحق للموردين", value: money(ov.ap), href: "/purchases/aging",
      note: ov.overdueAP > 0 ? `متأخر ${money(ov.overdueAP)}` : "مفيش متأخرات", tone: ov.overdueAP > 0 ? "warn" as const : undefined,
    }] : []),
    ...(seeStock && ov ? [{ label: "قيمة المخزون", value: money(ov.inventoryValue), href: "/inventory/stock", note: `${intl(ov.totalItems)} صنف` }] : []),
  ];

  const stock = {
    out: plan.filter((r) => r.status === "out").length,
    critical: plan.filter((r) => r.status === "critical").length,
    low: plan.filter((r) => r.status === "low").length,
  };
  const showMkt = !!ins && seeSales && hasMkt && (ins.mktSales > 0 || ins.pendingReturns > 0 || ins.reimbPending > 0);

  // Brand-new org with no transactional data yet → a getting-started hero instead of a
  // wall of zeros. (system_admin dashboards are never "empty".)
  const isEmpty = !!org && user.role !== "system_admin" && !ovRes.failed &&
    (!ov || (ov.net === 0 && ov.cash === 0 && ov.ar === 0 && ov.ap === 0 && ov.inventoryValue === 0 && ov.salesMonth === 0));
  const monthLabel = new Date().toLocaleDateString("ar-EG-u-nu-latn", { month: "long", year: "numeric" });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">مرحباً، {user.name}</h1>
          <p className="text-muted-foreground">{org?.nameAr ?? "الإدارة"} — نظرة على {monthLabel}</p>
        </div>
        <Link href="/apps" className="text-sm text-primary hover:underline">كل التطبيقات ←</Link>
      </div>

      <SubscriptionBanner sub={sub} />

      {setup && setup.essentialDone < setup.essentialTotal && (
        <div data-tour="setup-card">
          <SetupProgressCard done={setup.essentialDone} total={setup.essentialTotal} />
        </div>
      )}

      {ovRes.failed && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="flex items-center justify-between gap-4 p-4 text-sm text-destructive">
            <span>تعذّر تحميل المؤشرات دلوقتي — بياناتك سليمة، جرّب تحدّث الصفحة.</span>
            <Link href="/dashboard" className="shrink-0 underline">تحديث</Link>
          </CardContent>
        </Card>
      )}

      {isEmpty && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="p-6">
            <h2 className="text-lg font-bold">ابدأ باستخدام النظام 🚀</h2>
            <p className="mt-1 text-sm text-muted-foreground">حسابك جاهز — خطوات سريعة تبدأ بيها إدارة تجارتك:</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {[
                { t: "اربط حساب أمازون", d: "استورد طلباتك وتسوياتك تلقائيًا", href: "/platforms" },
                { t: "أضف أصنافك", d: "ابنِ كتالوج منتجاتك", href: "/inventory/items" },
                { t: "أنشئ أول فاتورة بيع", d: "وابدأ دورة البيع والتحصيل", href: "/sales/invoices" },
              ].map((s) => (
                <Link key={s.href} href={s.href} className="rounded-xl border bg-card p-4 transition-colors hover:border-primary">
                  <div className="font-semibold">{s.t}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{s.d}</div>
                </Link>
              ))}
            </div>
            <Link href="/setup" className="mt-4 inline-block text-sm text-primary hover:underline">أو اتبع دليل الإعداد الكامل ←</Link>
          </CardContent>
        </Card>
      )}

      {shortcuts.length > 0 && (
        <div>
          <Section title="اختصارات" />
          <div className="flex flex-wrap gap-2">
            {shortcuts.map((s) => (
              <Link key={s.href} href={s.href} className="inline-flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm font-medium transition-colors hover:border-primary hover:bg-accent">
                <Icon name={s.icon} className="size-4 text-primary" />{s.label}
              </Link>
            ))}
          </div>
        </div>
      )}

      {pendingTiles.some((t) => t.count > 0) && (
        <div>
          <Section title="بحاجة إلى إجراء" />
          <NeedsAttention tiles={pendingTiles} />
        </div>
      )}

      {kpis.length > 0 && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {kpis.map((k) => <StatCard key={k.label} s={k} />)}
        </div>
      )}

      {((seeSales && salesTrend.some((s) => s.value > 0)) || (seeMoney && ov?.pnlTrend.some((m) => m.revenue || m.expense))) && (
        <div className="grid gap-4 lg:grid-cols-2">
          {seeSales && salesTrend.some((s) => s.value > 0) && (
            <Card>
              <CardHeader><CardTitle>اتجاه المبيعات</CardTitle><CardDescription>الفواتير المُرحّلة يوميًا — آخر ٣٠ يوم.</CardDescription></CardHeader>
              <CardContent><TrendChart data={salesTrend} valueLabel="المبيعات" money id="dashboard-sales" /></CardContent>
            </Card>
          )}
          {seeMoney && ov && ov.pnlTrend.some((m) => m.revenue || m.expense) && (
            <Card>
              <CardHeader><CardTitle>الإيراد والمصروف</CardTitle><CardDescription>من القيود المُرحّلة — آخر ٦ شهور.</CardDescription></CardHeader>
              <CardContent>
                <GroupedBarChart
                  data={ov.pnlTrend.map((m) => ({ label: m.label, revenue: m.revenue, expense: m.expense }))}
                  series={[{ key: "revenue", name: "الإيراد", color: "#0d9488" }, { key: "expense", name: "المصروف", color: "#d97706" }]}
                />
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {seeSales && ins && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card>
            <CardHeader><CardTitle>المبيعات حسب القناة</CardTitle><CardDescription>أوامر البيع المؤكدة هذا الشهر.</CardDescription></CardHeader>
            <CardContent>
              <RankList
                rows={ins.channels.map((c) => ({ label: CHANNEL[c.channel] ?? c.channel, value: c.value, sub: `${intl(c.orders)} طلب` }))}
                empty="لسه مفيش طلبات الشهر ده"
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>الأكثر مبيعًا</CardTitle><CardDescription>أعلى ٥ أصناف بقيمة الفواتير هذا الشهر.</CardDescription></CardHeader>
            <CardContent>
              <RankList rows={ins.topItems.map((t) => ({ label: t.name, value: t.value, sub: `${intl(t.qty)} قطعة` }))} empty="لسه مفيش مبيعات الشهر ده" />
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>أكبر العملاء</CardTitle><CardDescription>أعلى ٥ عملاء بقيمة الفواتير هذا الشهر.</CardDescription></CardHeader>
            <CardContent>
              <RankList rows={ins.topCustomers.map((c) => ({ label: c.name, value: c.value, sub: `${intl(c.invoices)} فاتورة` }))} empty="لسه مفيش مبيعات الشهر ده" />
            </CardContent>
          </Card>
        </div>
      )}

      {(showMkt || (seeStock && ov)) && (
        <div className="grid gap-4 lg:grid-cols-2">
          {showMkt && ins && (
            <Card>
              <CardHeader>
                <CardTitle>المنصات</CardTitle>
                <CardDescription>تسويات أمازون ونون المُفرَج عنها — آخر ٣٠ يوم.</CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-3">
                <MiniStat s={{ label: "مبيعات المنتجات", value: money(ins.mktSales), href: "/platforms" }} />
                <MiniStat s={{
                  label: "رسوم المنصة", value: money(ins.mktFees), href: "/platforms",
                  note: ins.mktSales > 0 ? `${pct((ins.mktFees / ins.mktSales) * 100)} من المبيعات` : undefined,
                }} />
                <MiniStat s={{ label: "صافي التحويلات", value: money(ins.mktNet), href: "/platforms" }} />
                <MiniStat s={{
                  label: "تعويضات مستنية مراجعة", value: intl(ins.reimbPending), href: "/sales/marketplace-reimbursements",
                  note: ins.reimbPending > 0 ? money(ins.reimbAmount) : undefined, tone: ins.reimbPending > 0 ? "warn" : undefined,
                }} />
              </CardContent>
            </Card>
          )}
          {seeStock && ov && (
            <Card>
              <CardHeader>
                <CardTitle>صحة المخزون</CardTitle>
                <CardDescription>حسب معدّل البيع آخر ٣٠ يوم — الأصناف اللي عليها طلب بس.</CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <MiniStat s={{ label: "نافد وعليه طلب", value: intl(stock.out), href: "/inventory/reorder", tone: stock.out > 0 ? "down" : undefined }} />
                <MiniStat s={{ label: "هيخلص قبل الطلبية", value: intl(stock.critical), href: "/inventory/reorder", tone: stock.critical > 0 ? "down" : undefined }} />
                <MiniStat s={{ label: "منخفض", value: intl(stock.low), href: "/inventory/reorder", tone: stock.low > 0 ? "warn" : undefined }} />
                <MiniStat s={{ label: "قرب انتهاء الصلاحية", value: intl(ov.nearExpiryCount), href: "/inventory/expiry", tone: ov.nearExpiryCount > 0 ? "warn" : undefined }} />
                <MiniStat s={{ label: "منتهي الصلاحية", value: intl(ov.expiredCount), href: "/inventory/expiry", tone: ov.expiredCount > 0 ? "down" : undefined }} />
                <MiniStat s={{ label: "إجمالي الأصناف", value: intl(ov.totalItems), href: "/inventory/items" }} />
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {ov && ((seeSales && ov.recentSales.length > 0) || (seePurch && ov.recentPurchases.length > 0)) && (
        <div className="grid gap-4 lg:grid-cols-2">
          {seeSales && ov.recentSales.length > 0 && (
            <Card>
              <CardHeader><CardTitle>آخر فواتير البيع</CardTitle></CardHeader>
              <CardContent className="divide-y p-0 px-6 pb-4">
                {ov.recentSales.map((r) => (
                  <Link key={r.number} href={`/sales/invoices/${encodeURIComponent(r.number)}`} className="flex items-center gap-3 py-2 text-sm hover:text-primary">
                    <span className="font-mono text-xs">{r.number}</span>
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">{r.customer}</span>
                    <span className="text-xs text-muted-foreground">{shortDate(r.date)}</span>
                    <span className="font-medium tabular-nums">{money(r.amount)}</span>
                  </Link>
                ))}
              </CardContent>
            </Card>
          )}
          {seePurch && ov.recentPurchases.length > 0 && (
            <Card>
              <CardHeader><CardTitle>آخر فواتير الشراء</CardTitle></CardHeader>
              <CardContent className="divide-y p-0 px-6 pb-4">
                {ov.recentPurchases.map((r) => (
                  <Link key={r.number} href={`/purchases/invoices/${encodeURIComponent(r.number)}`} className="flex items-center gap-3 py-2 text-sm hover:text-primary">
                    <span className="font-mono text-xs">{r.number}</span>
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">{r.supplier}</span>
                    <span className="text-xs text-muted-foreground">{shortDate(r.date)}</span>
                    <span className="font-medium tabular-nums">{money(r.amount)}</span>
                  </Link>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
