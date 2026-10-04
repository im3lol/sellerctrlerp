import { desc, eq, sql } from "drizzle-orm";
import { fill, type Locale } from "@/lib/i18n";
import { getLocale, getT } from "@/lib/i18n/server";
import { db } from "@/lib/db";
import { organizations } from "@/db/schema";
import { withPlatformScope } from "@/lib/db-scope";
import { getOwnerAnalytics, getMrrTrend } from "@/lib/erp/platform-metrics";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Icon } from "@/components/icon";
import { TrendChart } from "@/components/charts/trend-chart";

/** YYYY-MM-DD → DD/MM for a compact x-axis label. */
const dayLabel = (iso: string) => { const [, m, d] = iso.split("-"); return `${d}/${m}`; };

const egp = (n: number, locale: Locale) => (locale === "en" ? `${Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 })} EGP` : `${Number(n).toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 0 })} ج.م`);
const int = (n: number) => n.toLocaleString("ar-EG-u-nu-latn");
const pct = (n: number, locale: Locale) => `${Number(n).toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 1 })}${locale === "en" ? "%" : "٪"}`;

export default async function AnalyticsPage() {
  const locale = await getLocale();
  const t = await getT();
  return withPlatformScope(async () => {
    const a = await getOwnerAnalytics();
    const trend = await getMrrTrend(90); // daily snapshots, ascending
    const mrrSeries = trend.map((t) => ({ label: dayLabel(t.date), value: t.mrr }));
    const activeSeries = trend.map((t) => ({ label: dayLabel(t.date), value: t.activeCount }));

    // Acquisition attribution: where tenants came from at signup.
    const sources = await db.select({
      source: sql<string>`coalesce(nullif(${organizations.signupSource}, ''), 'غير معروف')`,
      n: sql<number>`count(*)::int`,
    }).from(organizations).where(eq(organizations.isSandbox, false)).groupBy(organizations.signupSource).orderBy(desc(sql`count(*)`)).limit(10);
    const srcTotal = Math.max(1, sources.reduce((s, r) => s + Number(r.n), 0));

    const kpis = [
      { label: "الإيراد الشهري (MRR)", value: egp(a.mrr, locale), icon: "TrendingUp", accent: true },
      { label: "متوسط الإيراد لكل عميل (ARPU)", value: egp(a.arpu, locale), icon: "Users", hint: fill(t("{0} عميل مفعّل"), [int(a.activeCount)]) },
      { label: "معدل التحويل", value: pct(a.conversionRate, locale), icon: "Target", hint: fill(t("{0} من {1} مؤسسة فعّلت"), [int(a.convertedOrgs), int(a.orgCount)]) },
      { label: "القيمة الدائمة المقدّرة (LTV)", value: a.ltv != null ? egp(a.ltv, locale) : "—", icon: "Gem", hint: a.ltv == null ? t("يحتاج بيانات churn") : "ARPU ÷ churn" },
    ];

    // Simple funnel: signups(30d) → active (converted).
    const funnel = [
      { label: "تسجيلات جديدة (٣٠ يوم)", value: a.newSignups30d, icon: "UserPlus" },
      { label: "قيد التجربة الآن", value: a.trialCount, icon: "Sparkles" },
      { label: "مفعّل (مدفوع)", value: a.activeCount, icon: "BadgeCheck" },
    ];
    const funMax = Math.max(1, ...funnel.map((f) => f.value));

    return (
      <div className="space-y-6">
        <PageHeader title={t("التحليلات")} description={t("مؤشرات النمو كـ SaaS — التحويل والاحتفاظ وقيمة العميل. المعدلات تتحسّن كلما تجمّع التاريخ.")} />

        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
          {kpis.map((k) => (
            <Card key={k.label} className={k.accent ? "border-primary/40 bg-primary/5" : undefined}><CardContent className="pt-6">
              <div className="flex items-center gap-2 text-sm text-muted-foreground"><Icon name={k.icon} className="size-4" />{t(k.label)}</div>
              <div className="mt-1 text-2xl font-bold tabular-nums">{k.value}</div>
              {k.hint && <div className="text-xs text-muted-foreground">{k.hint}</div>}
            </CardContent></Card>
          ))}
        </div>

        {/* Growth lines — the "up and to the right" investors look for. Fills daily from
            the MRR snapshots; sparse until history accrues. */}
        <div className="grid gap-4 lg:grid-cols-2">
          <Card><CardContent className="pt-6">
            <h3 className="mb-4 flex items-center gap-2 font-semibold"><Icon name="TrendingUp" className="size-4" />{t("نموّ الإيراد الشهري (MRR)")}</h3>
            {mrrSeries.length >= 2
              ? <TrendChart data={mrrSeries} valueLabel="MRR" money id="mrr" />
              : <p className="py-12 text-center text-sm text-muted-foreground">{t("لسه بيتراكم — لقطة MRR بتتسجّل يوميًا، والخط هيظهر بعد أول يومين.")}</p>}
          </CardContent></Card>
          <Card><CardContent className="pt-6">
            <h3 className="mb-4 flex items-center gap-2 font-semibold"><Icon name="Users" className="size-4" />{t("نموّ العملاء المفعّلين")}</h3>
            {activeSeries.length >= 2
              ? <TrendChart data={activeSeries} valueLabel={t("عملاء مفعّلين")} id="active" />
              : <p className="py-12 text-center text-sm text-muted-foreground">{t("لسه بيتراكم يوميًا.")}</p>}
          </CardContent></Card>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          {/* Conversion funnel */}
          <Card><CardContent className="pt-6">
            <h3 className="mb-4 flex items-center gap-2 font-semibold"><Icon name="Filter" className="size-4" />{t("قمع التحويل")}</h3>
            <ul className="space-y-3">
              {funnel.map((f) => (
                <li key={f.label}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2 text-muted-foreground"><Icon name={f.icon} className="size-4" />{t(f.label)}</span>
                    <span className="tabular-nums font-semibold">{int(f.value)}</span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.round((f.value / funMax) * 100)}%` }} /></div>
                </li>
              ))}
            </ul>
          </CardContent></Card>

          {/* MRR movement (30d) */}
          <Card><CardContent className="pt-6">
            <h3 className="mb-4 flex items-center gap-2 font-semibold"><Icon name="ArrowLeftRight" className="size-4" />{t("حركة الإيراد (٣٠ يوم)")}</h3>
            <ul className="space-y-2.5 text-sm">
              <li className="flex justify-between"><span className="text-muted-foreground">{t("إيراد جديد")}</span><span className="tabular-nums text-emerald-600">+{egp(a.newMrr30d, locale)}</span></li>
              <li className="flex justify-between"><span className="text-muted-foreground">{t("إيراد منسحب (churn)")}</span><span className="tabular-nums text-destructive">−{egp(a.churnedMrr30d, locale)}</span></li>
              <li className="flex justify-between border-t pt-2"><span className="text-muted-foreground">{t("معدل الـchurn الشهري")}</span><span className="tabular-nums font-medium">{pct(a.churnRate, locale)}</span></li>
              <li className="flex justify-between"><span className="text-muted-foreground">{t("الإيراد السنوي (ARR)")}</span><span className="tabular-nums font-medium">{egp(a.arr, locale)}</span></li>
            </ul>
            {a.churnedMrr30d === 0 && a.newMrr30d === 0 && (
              <p className="mt-3 border-t pt-2 text-xs text-muted-foreground">{t("لسه مفيش أحداث اشتراك في آخر ٣٠ يوم — الأرقام دي هتتعبّى مع الاستخدام.")}</p>
            )}
          </CardContent></Card>
        </div>

        {/* Acquisition sources */}
        <Card><CardContent className="pt-6">
          <h3 className="mb-1 flex items-center gap-2 font-semibold"><Icon name="Compass" className="size-4" />{t("مصادر التسجيل")}</h3>
          <p className="mb-4 text-xs text-muted-foreground">{t("من أين جاء العملاء عند التسجيل (utm_source أو الموقع المُحيل).")}</p>
          {sources.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">{t("لا بيانات مصادر بعد.")}</p>
          ) : (
            <ul className="space-y-3">
              {sources.map((s) => (
                <li key={s.source}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="truncate" dir="ltr">{t(s.source)}</span>
                    <span className="tabular-nums font-semibold">{int(Number(s.n))} <span className="text-xs font-normal text-muted-foreground">({pct((Number(s.n) / srcTotal) * 100, locale)})</span></span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.round((Number(s.n) / srcTotal) * 100)}%` }} /></div>
                </li>
              ))}
            </ul>
          )}
        </CardContent></Card>
      </div>
    );
  });
}
