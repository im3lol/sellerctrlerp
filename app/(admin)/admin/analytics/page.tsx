import { withPlatformScope } from "@/lib/db-scope";
import { getOwnerAnalytics } from "@/lib/erp/platform-metrics";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Icon } from "@/components/icon";

const egp = (n: number) => `${Number(n).toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 0 })} ج.م`;
const int = (n: number) => n.toLocaleString("ar-EG-u-nu-latn");
const pct = (n: number) => `${Number(n).toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 1 })}٪`;

export default async function AnalyticsPage() {
  return withPlatformScope(async () => {
    const a = await getOwnerAnalytics();

    const kpis = [
      { label: "الإيراد الشهري (MRR)", value: egp(a.mrr), icon: "TrendingUp", accent: true },
      { label: "متوسط الإيراد لكل عميل (ARPU)", value: egp(a.arpu), icon: "Users", hint: `${int(a.activeCount)} عميل مفعّل` },
      { label: "معدل التحويل", value: pct(a.conversionRate), icon: "Target", hint: `${int(a.convertedOrgs)} من ${int(a.orgCount)} مؤسسة فعّلت` },
      { label: "القيمة الدائمة المقدّرة (LTV)", value: a.ltv != null ? egp(a.ltv) : "—", icon: "Gem", hint: a.ltv == null ? "يحتاج بيانات churn" : "ARPU ÷ churn" },
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
        <PageHeader title="التحليلات" description="مؤشرات النمو كـ SaaS — التحويل والاحتفاظ وقيمة العميل. المعدلات تتحسّن كلما تجمّع التاريخ." />

        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
          {kpis.map((k) => (
            <Card key={k.label} className={k.accent ? "border-primary/40 bg-primary/5" : undefined}><CardContent className="pt-6">
              <div className="flex items-center gap-2 text-sm text-muted-foreground"><Icon name={k.icon} className="size-4" />{k.label}</div>
              <div className="mt-1 text-2xl font-bold tabular-nums">{k.value}</div>
              {k.hint && <div className="text-xs text-muted-foreground">{k.hint}</div>}
            </CardContent></Card>
          ))}
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          {/* Conversion funnel */}
          <Card><CardContent className="pt-6">
            <h3 className="mb-4 flex items-center gap-2 font-semibold"><Icon name="Filter" className="size-4" />قمع التحويل</h3>
            <ul className="space-y-3">
              {funnel.map((f) => (
                <li key={f.label}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2 text-muted-foreground"><Icon name={f.icon} className="size-4" />{f.label}</span>
                    <span className="tabular-nums font-semibold">{int(f.value)}</span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.round((f.value / funMax) * 100)}%` }} /></div>
                </li>
              ))}
            </ul>
          </CardContent></Card>

          {/* MRR movement (30d) */}
          <Card><CardContent className="pt-6">
            <h3 className="mb-4 flex items-center gap-2 font-semibold"><Icon name="ArrowLeftRight" className="size-4" />حركة الإيراد (٣٠ يوم)</h3>
            <ul className="space-y-2.5 text-sm">
              <li className="flex justify-between"><span className="text-muted-foreground">إيراد جديد</span><span className="tabular-nums text-emerald-600">+{egp(a.newMrr30d)}</span></li>
              <li className="flex justify-between"><span className="text-muted-foreground">إيراد منسحب (churn)</span><span className="tabular-nums text-destructive">−{egp(a.churnedMrr30d)}</span></li>
              <li className="flex justify-between border-t pt-2"><span className="text-muted-foreground">معدل الـchurn الشهري</span><span className="tabular-nums font-medium">{pct(a.churnRate)}</span></li>
              <li className="flex justify-between"><span className="text-muted-foreground">الإيراد السنوي (ARR)</span><span className="tabular-nums font-medium">{egp(a.arr)}</span></li>
            </ul>
            {a.churnedMrr30d === 0 && a.newMrr30d === 0 && (
              <p className="mt-3 border-t pt-2 text-xs text-muted-foreground">لسه مفيش أحداث اشتراك في آخر ٣٠ يوم — الأرقام دي هتتعبّى مع الاستخدام.</p>
            )}
          </CardContent></Card>
        </div>
      </div>
    );
  });
}
