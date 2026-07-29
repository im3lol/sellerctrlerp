import Link from "next/link";
import { requireUser } from "@/lib/session";
import { getActiveOrg } from "@/lib/erp/org";
import { getEnabledModules } from "@/lib/erp/entitlements";
import { getSubscriptionState } from "@/lib/erp/subscription";
import { getErpOverview, getPendingWork, getSalesTrend } from "@/lib/erp/overview";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { NeedsAttention } from "@/components/erp/needs-attention";
import { SetupProgressCard } from "@/components/erp/setup-progress-card";
import { getSetupStatus } from "@/lib/erp/setup-status";
import { TrendChart } from "@/components/charts/trend-chart";
import { Icon } from "@/components/icon";

const TILES: { label: string; href: string; icon: string; module: string; desc: string }[] = [
  { label: "المحاسبة", href: "/accounting", icon: "Calculator", module: "accounting", desc: "دليل الحسابات، القيود، التقارير المالية" },
  // Both point at the module overview, like المحاسبة above. المبيعات used to jump
  // straight to the order list because /erp/sales was the customer file, not a
  // module landing page.
  { label: "المبيعات", href: "/sales", icon: "ShoppingCart", module: "sales", desc: "العملاء، أوامر البيع، الفواتير، أمازون" },
  { label: "المشتريات", href: "/purchases", icon: "Truck", module: "purchases", desc: "الموردون، أوامر الشراء، الاستلام، الفواتير" },
  { label: "المخزون", href: "/inventory", icon: "Boxes", module: "inventory", desc: "الأصناف، الأرصدة، الحركة، التسويات" },
  { label: "الموارد البشرية", href: "/hr", icon: "UserCog", module: "hr", desc: "الموظفون، الإجازات، مسير الرواتب" },
  { label: "المستثمرون", href: "/investors", icon: "Coins", module: "investors", desc: "المستثمرون وحصصهم" },
  { label: "التقارير", href: "/reports", icon: "ChartPie", module: "reports", desc: "ميزان المراجعة، الدخل، الميزانية، الضريبة" },
];

const money = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const intl = (n: number) => n.toLocaleString("ar-EG-u-nu-latn");

export default async function DashboardPage() {
  const user = await requireUser();
  const { org } = await getActiveOrg();
  const enabled = user.role === "system_admin" || !org ? null : await getEnabledModules(org.id);
  const tiles = TILES.filter((t) => !enabled || enabled.has(t.module));
  const sub = org && user.role !== "system_admin" ? await getSubscriptionState(org.id) : null;
  const subBanner = sub && sub.isTrial
    ? { cls: "border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-400", text: `الفترة التجريبية — متبقٍ ${sub.daysLeft} يوم. اشترك الآن للاستمرار.` }
    : sub && sub.status === "SUSPENDED"
    ? { cls: "border-destructive/40 bg-destructive/5 text-destructive", text: "تم إيقاف اشتراكك مؤقتًا — تواصل مع الدعم لإعادة التفعيل." }
    : sub && !sub.live
    ? { cls: "border-destructive/40 bg-destructive/5 text-destructive", text: "انتهت فترة وصولك — اختر باقة لتفعيل النظام." }
    : null;
  // Degrade gracefully: the overview fans out many queries; if it fails (e.g. a
  // transient pooler hiccup) still render the module tiles instead of crashing.
  let ov: Awaited<ReturnType<typeof getErpOverview>> | null = null;
  try { ov = org ? await getErpOverview(org.id) : null; } catch { ov = null; }

  // Consolidated cross-module workflow inbox (one query, fail-safe).
  let pending: Awaited<ReturnType<typeof getPendingWork>> | null = null;
  try { pending = org ? await getPendingWork(org.id) : null; } catch { pending = null; }

  // 30-day sales trend (fail-safe — degrades to no chart).
  let salesTrend: { label: string; value: number }[] = [];
  try { salesTrend = org ? await getSalesTrend(org.id, 30) : []; } catch { salesTrend = []; }

  // Setup nudge while essential onboarding is incomplete (fail-safe, admins only).
  let setup: Awaited<ReturnType<typeof getSetupStatus>> | null = null;
  if (org && user.role !== "system_admin") {
    try { setup = await getSetupStatus(org.id); } catch { setup = null; }
  }
  const pendingTiles = pending
    ? [
        { label: "قيود غير مُرحّلة", hint: "المحاسبة", count: pending.jeDraft, href: "/accounting/journal", icon: "BookText" },
        { label: "فواتير بيع مسودة", hint: "المبيعات", count: pending.siDraft, href: "/sales/invoices", icon: "ReceiptText" },
        { label: "فواتير شراء مسودة", hint: "المشتريات", count: pending.piDraft, href: "/purchases/invoices", icon: "ReceiptText" },
        { label: "أوامر بيع بانتظار الشحن", hint: "المبيعات", count: pending.soAwaiting, href: "/sales/orders", icon: "ClipboardList" },
        { label: "أوامر شراء بانتظار الاستلام", hint: "المشتريات", count: pending.poAwaiting, href: "/purchases/orders", icon: "PackageCheck" },
      ]
    : [];

  const kpis = ov
    ? [
        { label: "صافي الربح", value: money(ov.net), href: "/reports/income-statement", tone: ov.net >= 0 ? "text-emerald-600" : "text-destructive" },
        { label: "النقدية والبنك", value: money(ov.cash), href: "/accounting/ledger", tone: "" },
        { label: "ذمم مدينة (عملاء)", value: money(ov.ar), href: "/sales/aging", tone: "" },
        { label: "ذمم دائنة (موردون)", value: money(ov.ap), href: "/purchases/aging", tone: "" },
        { label: "قيمة المخزون", value: money(ov.inventoryValue), href: "/inventory/stock", tone: "" },
        { label: "مبيعات هذا الشهر", value: money(ov.salesMonth), href: "/sales/invoices", tone: "" },
      ]
    : [];

  // Brand-new org with no transactional data yet → show a getting-started hero
  // instead of a wall of zeros. (system_admin dashboards are never "empty".)
  const isEmpty = !!org && user.role !== "system_admin" &&
    (!ov || (ov.net === 0 && ov.cash === 0 && ov.ar === 0 && ov.ap === 0 && ov.inventoryValue === 0 && ov.salesMonth === 0));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">مرحباً، {user.name}</h1>
        <p className="text-muted-foreground">نظام {org?.nameAr ?? "الإدارة"} — نظرة عامة سريعة.</p>
      </div>

      {subBanner && (
        <Link href="/settings/subscription" className={`flex items-center justify-between rounded-2xl border p-4 ${subBanner.cls}`}>
          <span className="text-sm font-medium">{subBanner.text}</span>
          <span className="text-sm underline">إدارة الاشتراك ←</span>
        </Link>
      )}

      {setup && setup.essentialDone < setup.essentialTotal && (
        <div data-tour="setup-card">
          <SetupProgressCard done={setup.essentialDone} total={setup.essentialTotal} />
        </div>
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

      {ov && (
        <>
          <div className="grid gap-4 grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            {kpis.map((k) => (
              <Link key={k.label} href={k.href}>
                <Card className="h-full transition-colors hover:border-primary/50">
                  <CardContent className="pt-6">
                    <div className="text-xs text-muted-foreground">{k.label}</div>
                    <div className={`mt-1 text-xl font-bold tabular-nums ${k.tone}`}>{k.value}</div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>

          {(ov.lowStock > 0 || ov.outOfStock > 0 || ov.overdueAR > 0 || ov.nearExpiryCount > 0) && (
            <div className="flex flex-wrap gap-2 text-sm">
              {ov.overdueAR > 0 && <Link href="/sales/aging" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-1.5 text-destructive hover:bg-destructive/10">ذمم متأخرة: {money(ov.overdueAR)}</Link>}
              {ov.outOfStock > 0 && <Link href="/inventory/reorder" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-1.5 text-destructive hover:bg-destructive/10">أصناف نافدة: {intl(ov.outOfStock)}</Link>}
              {ov.lowStock > 0 && <Link href="/inventory/reorder" className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-1.5 text-amber-700 hover:bg-amber-500/10 dark:text-amber-400">مخزون منخفض: {intl(ov.lowStock)}</Link>}
              {ov.nearExpiryCount > 0 && <Link href="/inventory/expiry" className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-1.5 text-amber-700 hover:bg-amber-500/10 dark:text-amber-400">قرب انتهاء الصلاحية: {intl(ov.nearExpiryCount)}</Link>}
            </div>
          )}
          {salesTrend.some((s) => s.value > 0) && (
            <Card>
              <CardHeader><CardTitle>اتجاه المبيعات</CardTitle><CardDescription>مبيعات مُرحّلة يوميًا — آخر ٣٠ يومًا.</CardDescription></CardHeader>
              <CardContent><TrendChart data={salesTrend} valueLabel="المبيعات" money id="dashboard-sales" /></CardContent>
            </Card>
          )}
        </>
      )}

      {pendingTiles.some((t) => t.count > 0) && (
        <div>
          <h2 className="mb-3 text-sm font-semibold text-muted-foreground">بحاجة إلى إجراء</h2>
          <NeedsAttention tiles={pendingTiles} />
        </div>
      )}

      <div>
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground">الوحدات</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-tour="dashboard-tiles">
          {tiles.map((t) => (
            <Link key={t.href} href={t.href}>
              <Card className="h-full transition-colors hover:border-primary/50 hover:bg-accent/40">
                <CardContent className="flex items-start gap-4 p-5">
                  <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                    <Icon name={t.icon} className="size-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="font-semibold">{t.label}</div>
                    <div className="text-sm text-muted-foreground">{t.desc}</div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
