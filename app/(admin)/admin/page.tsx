import { withPlatformScope } from "@/lib/db-scope";
import Link from "next/link";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { discountCoupons } from "@/db/schema";
import { computePlatformMetrics, getMrrTrend, getSubscriptionMovements } from "@/lib/erp/platform-metrics";
import { Icon } from "@/components/icon";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const int = (n: number) => n.toLocaleString("ar-EG-u-nu-latn");
const egp = (n: number) => `${Number(n).toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 0 })} ج.م`;
const dt = (d: Date) => new Date(d).toLocaleDateString("ar-EG-u-nu-latn", { year: "numeric", month: "short", day: "numeric" });

const EVENT_LABEL: Record<string, string> = { ACTIVATED: "تفعيل", RENEWED: "تجديد", UPGRADED: "ترقية", DOWNGRADED: "تخفيض", EXPIRED: "انتهاء", CANCELLED: "إلغاء" };

/** Inline area chart of MRR over time — no external lib, theme-aware via the primary token. */
function MrrTrend({ points }: { points: { date: string; mrr: number }[] }) {
  if (points.length < 2)
    return <p className="grid h-[140px] place-items-center text-center text-sm text-muted-foreground">يتجمّع التاريخ من اليوم — ارجع بعد أيام لرؤية الاتجاه. 📈</p>;
  const W = 600, H = 140, pad = 8;
  const max = Math.max(...points.map((p) => p.mrr), 1), min = Math.min(...points.map((p) => p.mrr), 0);
  const x = (i: number) => pad + (i / (points.length - 1)) * (W - 2 * pad);
  const y = (v: number) => H - pad - ((v - min) / (max - min || 1)) * (H - 2 * pad);
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.mrr).toFixed(1)}`).join(" ");
  const area = `${line} L${x(points.length - 1).toFixed(1)},${H - pad} L${x(0).toFixed(1)},${H - pad} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none" role="img" aria-label="اتجاه الإيراد الشهري المتكرر">
      <path d={area} className="fill-primary/10" />
      <path d={line} className="fill-none stroke-primary" strokeWidth={2} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

const SECTIONS = [
  { label: "الباقات", desc: "خطط الاشتراك: الوحدات والحدود والأسعار.", href: "/admin/plans", icon: "Package" },
  { label: "المؤسسات والاشتراكات", desc: "الاشتراكات، الاستهلاك، طلبات التفعيل.", href: "/admin/licensing", icon: "Building2" },
  { label: "كوبونات الخصم", desc: "أكواد خصم على سعر الاشتراك.", href: "/admin/coupons", icon: "Ticket" },
  { label: "أدوات النظام", desc: "حالة الخادم وقاعدة البيانات والتخزين.", href: "/admin/system", icon: "Server" },
] as const;

export default async function AdminHome() {
  return withPlatformScope(async () => {
    const m = await computePlatformMetrics();
    const trend = await getMrrTrend(90);
    const { month: mv, recent } = await getSubscriptionMovements();
    const [{ coupons } = { coupons: 0 }] = await db
      .select({ coupons: sql<number>`count(*)::int` }).from(discountCoupons).where(sql`is_active`);

    const hero = [
      { label: "الإيراد الشهري المتكرر (MRR)", value: egp(m.mrr), icon: "TrendingUp", accent: true },
      { label: "الإيراد السنوي (ARR)", value: egp(m.arr), icon: "Coins" },
      { label: "مؤسسات مفعّلة", value: int(m.activeCount), icon: "BadgeCheck", hint: m.newActiveThisMonth ? `+${int(m.newActiveThisMonth)} هذا الشهر` : undefined },
      { label: "إجمالي المؤسسات", value: int(m.orgCount), icon: "Building2", hint: `${int(m.trialCount)} تجريبي · ${int(m.expiredCount)} منتهٍ` },
    ];
    const maxPlanMrr = Math.max(1, ...m.planMix.map((p) => p.mrr));

    return (
      <div className="space-y-6">
        <PageHeader title="لوحة الإدارة" description="أداء المنصّة كـ SaaS — الإيراد والاشتراكات والتجديدات، منفصلة عن استخدام الـ ERP." />

        {/* Hero KPIs */}
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
          {hero.map((s) => (
            <Card key={s.label} className={s.accent ? "border-primary/40 bg-primary/5" : undefined}>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2 text-sm text-muted-foreground"><Icon name={s.icon} className="size-4" />{s.label}</div>
                <div className="mt-1 text-2xl font-bold tabular-nums">{s.value}</div>
                {s.hint && <div className="text-xs text-muted-foreground">{s.hint}</div>}
              </CardContent>
            </Card>
          ))}
        </div>

        {/* MRR trend + this-month movement */}
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardContent className="pt-6">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="flex items-center gap-2 font-semibold"><Icon name="TrendingUp" className="size-4" />اتجاه الإيراد الشهري (MRR)</h3>
                <span className="text-sm tabular-nums text-muted-foreground">{egp(m.mrr)}/شهر</span>
              </div>
              <MrrTrend points={trend} />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <h3 className="mb-3 flex items-center gap-2 font-semibold"><Icon name="ArrowLeftRight" className="size-4" />حركة الشهر</h3>
              <ul className="space-y-2 text-sm">
                <li className="flex justify-between"><span className="text-muted-foreground">جديد</span><span className="tabular-nums text-emerald-600">+{egp(mv.newMrr)}</span></li>
                <li className="flex justify-between"><span className="text-muted-foreground">ترقيات</span><span className="tabular-nums text-emerald-600">+{egp(mv.expansionMrr)}</span></li>
                <li className="flex justify-between"><span className="text-muted-foreground">تخفيضات</span><span className="tabular-nums text-amber-600">−{egp(mv.contractionMrr)}</span></li>
                <li className="flex justify-between"><span className="text-muted-foreground">منسحب (churn)</span><span className="tabular-nums text-destructive">−{egp(mv.churnedMrr)}</span></li>
                <li className="mt-1 flex justify-between border-t pt-2 font-medium"><span>الصافي</span><span className={`tabular-nums ${mv.net >= 0 ? "text-emerald-600" : "text-destructive"}`}>{mv.net >= 0 ? "+" : "−"}{egp(Math.abs(mv.net))}</span></li>
              </ul>
              {recent.length > 0 && (
                <div className="mt-3 border-t pt-2">
                  <div className="mb-1 text-xs text-muted-foreground">أحدث الأحداث</div>
                  <ul className="space-y-1 text-xs">
                    {recent.slice(0, 4).map((e, i) => (
                      <li key={i} className="flex items-center justify-between gap-2">
                        <span className="truncate text-muted-foreground">{EVENT_LABEL[e.type] ?? e.type}{e.planName ? ` · ${e.planName}` : ""}</span>
                        <span className={`shrink-0 tabular-nums ${e.mrrDelta >= 0 ? "text-emerald-600" : "text-destructive"}`}>{e.mrrDelta >= 0 ? "+" : "−"}{egp(Math.abs(e.mrrDelta))}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          {/* Renewal alerts */}
          <Card>
            <CardContent className="pt-6">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="flex items-center gap-2 font-semibold"><Icon name="CalendarClock" className="size-4" />تنبيهات التجديد (خلال ٣٠ يومًا)</h3>
                <Badge variant={m.expiringSoon.length ? "secondary" : "outline"}>{int(m.expiringSoon.length)}</Badge>
              </div>
              {m.expiringSoon.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">لا اشتراكات قرب انتهائها. 🎉</p>
              ) : (
                <ul className="space-y-2">
                  {m.expiringSoon.slice(0, 8).map((e) => (
                    <li key={e.orgId} className="flex items-center justify-between gap-3 rounded-lg border p-2.5 text-sm">
                      <div className="min-w-0">
                        <div className="truncate font-medium">{e.orgName}</div>
                        <div className="text-xs text-muted-foreground">{e.planName ?? "—"} · {dt(e.expiresAt)}</div>
                      </div>
                      <Badge variant={e.daysLeft <= 7 ? "destructive" : "secondary"} className="shrink-0 tabular-nums">
                        {e.daysLeft === 0 ? "ينتهي اليوم" : `${int(e.daysLeft)} يوم`}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* Plan mix */}
          <Card>
            <CardContent className="pt-6">
              <h3 className="mb-3 flex items-center gap-2 font-semibold"><Icon name="PieChart" className="size-4" />توزيع الإيراد على الباقات</h3>
              {m.planMix.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">لا اشتراكات مفعّلة بعد.</p>
              ) : (
                <ul className="space-y-3">
                  {m.planMix.map((p) => (
                    <li key={p.planName}>
                      <div className="mb-1 flex items-center justify-between text-sm">
                        <span className="font-medium">{p.planName} <span className="text-xs text-muted-foreground">({int(p.count)})</span></span>
                        <span className="tabular-nums text-muted-foreground">{egp(p.mrr)}/شهر</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${Math.round((p.mrr / maxPlanMrr) * 100)}%` }} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Secondary counters */}
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
          <Link href="/admin/licensing" className="block">
            <Card className={m.pendingRequests ? "border-amber-500/40 bg-amber-500/5 transition-colors hover:border-amber-500" : "transition-colors hover:border-primary"}>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2 text-sm text-muted-foreground"><Icon name="Clock" className="size-4" />طلبات تفعيل معلّقة</div>
                <div className="mt-1 text-2xl font-bold tabular-nums">{int(m.pendingRequests)}</div>
                {m.pendingRequests > 0 && <div className="text-xs text-amber-600">تحتاج مراجعة ←</div>}
              </CardContent>
            </Card>
          </Link>
          {[
            { label: "تجريبي", value: int(m.trialCount), icon: "Sparkles" },
            { label: "منتهٍ / ملغى", value: int(m.expiredCount + m.cancelledCount), icon: "AlertTriangle" },
            { label: "كوبونات فعّالة", value: int(Number(coupons ?? 0)), icon: "Ticket" },
          ].map((s) => (
            <Card key={s.label}><CardContent className="pt-6">
              <div className="flex items-center gap-2 text-sm text-muted-foreground"><Icon name={s.icon} className="size-4" />{s.label}</div>
              <div className="mt-1 text-2xl font-bold tabular-nums">{s.value}</div>
            </CardContent></Card>
          ))}
        </div>

        {/* Section links */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {SECTIONS.map((s) => (
            <Link key={s.href} href={s.href} className="group flex items-start gap-3 rounded-xl border bg-card p-4 transition-colors hover:border-primary hover:bg-accent">
              <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground"><Icon name={s.icon} className="size-5" /></div>
              <div><div className="font-semibold">{s.label}</div><div className="text-xs text-muted-foreground">{s.desc}</div></div>
            </Link>
          ))}
        </div>
      </div>
    );
  });
}
