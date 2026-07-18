import Link from "next/link";
import { notFound } from "next/navigation";
import { getTenantDetail } from "@/lib/erp/tenant-detail";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/icon";
import { Progress } from "@/components/ui/progress";
import { TenantActions } from "@/components/admin/tenant-actions";

const egp = (n: number) => `${Number(n).toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 0 })} ج.م`;
const dt = (d: Date | null) => (d ? new Date(d).toLocaleDateString("ar-EG-u-nu-latn", { year: "numeric", month: "short", day: "numeric" }) : "—");
const fmtBytes = (b: number) => (b < 1024 * 1024 ? `${(b / 1024).toFixed(0)} ك.ب` : b < 1024 ** 3 ? `${(b / 1024 / 1024).toFixed(1)} م.ب` : `${(b / 1024 ** 3).toFixed(2)} ج.ب`);
const int = (n: number) => n.toLocaleString("ar-EG-u-nu-latn");

const EVENT: Record<string, { label: string; icon: string }> = {
  ACTIVATED: { label: "تفعيل", icon: "BadgeCheck" }, RENEWED: { label: "تجديد", icon: "RefreshCw" },
  UPGRADED: { label: "ترقية", icon: "TrendingUp" }, DOWNGRADED: { label: "تخفيض", icon: "TrendingDown" },
  EXPIRED: { label: "انتهاء", icon: "CircleAlert" }, CANCELLED: { label: "إلغاء", icon: "CircleX" },
};
const HEALTH: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  healthy: { label: "نشط سليم", variant: "default" }, at_risk: { label: "معرّض للخطر", variant: "destructive" },
  expired: { label: "منتهٍ", variant: "destructive" }, trial: { label: "تجريبي", variant: "secondary" },
};
const METHOD: Record<string, string> = { INSTAPAY: "إنستاباي", BANK: "تحويل بنكي", VISA: "فيزا", CASH: "نقدًا", OTHER: "أخرى" };

export default async function TenantPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTenantDetail(id);
  if (!t) notFound();
  const h = HEALTH[t.health] ?? HEALTH.trial;
  const pct = (n: number, cap: number | null) => (cap && cap > 0 ? Math.min(100, Math.round((n / cap) * 100)) : null);
  const seatPct = pct(t.usage.members, t.usage.maxUsers);
  const storagePct = pct(t.usage.storageBytes, t.usage.storageGb ? t.usage.storageGb * 1024 ** 3 : null);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader title={t.org.name} description={`عميل منذ ${dt(t.org.createdAt)}${t.org.email ? ` · ${t.org.email}` : ""}`} />
        <Link href="/admin/licensing" className="text-sm text-muted-foreground hover:text-foreground">← كل المؤسسات</Link>
      </div>

      {/* KPI row */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <Card className="border-primary/40 bg-primary/5"><CardContent className="pt-6">
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Icon name="TrendingUp" className="size-4" />الإيراد الشهري</div>
          <div className="mt-1 text-2xl font-bold tabular-nums">{egp(t.mrr)}</div>
        </CardContent></Card>
        <Card><CardContent className="pt-6">
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Icon name="Activity" className="size-4" />الحالة</div>
          <div className="mt-1"><Badge variant={h.variant}>{h.label}</Badge></div>
          <div className="mt-1 text-xs text-muted-foreground">{t.sub?.planName ?? "بلا باقة"}{t.daysLeft != null ? ` · ${t.daysLeft <= 0 ? "منتهٍ" : `${int(t.daysLeft)} يوم`}` : ""}</div>
        </CardContent></Card>
        <Card><CardContent className="pt-6">
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Icon name="Wallet" className="size-4" />إجمالي المُحصّل</div>
          <div className="mt-1 text-2xl font-bold tabular-nums">{egp(t.collectedTotal)}</div>
        </CardContent></Card>
        <Card><CardContent className="pt-6">
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Icon name="Clock" className="size-4" />آخر نشاط</div>
          <div className="mt-1 text-lg font-semibold">{dt(t.lastActivityAt)}</div>
        </CardContent></Card>
      </div>

      <TenantActions orgId={t.org.id} />

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Usage */}
        <Card><CardContent className="space-y-4 pt-6">
          <h3 className="flex items-center gap-2 font-semibold"><Icon name="Gauge" className="size-4" />الاستهلاك</h3>
          <div>
            <div className="mb-1 flex justify-between text-sm"><span className="text-muted-foreground">المستخدمون</span><span className="tabular-nums">{int(t.usage.members)}{t.usage.maxUsers != null ? ` / ${int(t.usage.maxUsers)}` : " / ∞"}</span></div>
            {seatPct != null && <Progress value={seatPct} />}
          </div>
          <div>
            <div className="mb-1 flex justify-between text-sm"><span className="text-muted-foreground">التخزين</span><span className="tabular-nums">{fmtBytes(t.usage.storageBytes)}{t.usage.storageGb != null ? ` / ${t.usage.storageGb} ج.ب` : ""}</span></div>
            {storagePct != null && <Progress value={storagePct} />}
          </div>
          <div className="flex justify-between border-t pt-2 text-sm"><span className="text-muted-foreground">الوحدات المفعّلة</span><span className="tabular-nums">{t.sub?.enabledModules?.length ?? 0}</span></div>
        </CardContent></Card>

        {/* Subscription timeline */}
        <Card className="lg:col-span-2"><CardContent className="pt-6">
          <h3 className="mb-3 flex items-center gap-2 font-semibold"><Icon name="History" className="size-4" />سجل الاشتراك</h3>
          {t.events.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">لا أحداث بعد (يتجمّع من وقت التفعيل).</p>
          ) : (
            <ul className="space-y-2.5">
              {t.events.map((e) => {
                const ev = EVENT[e.type] ?? { label: e.type, icon: "Circle" };
                const d = Number(e.mrrDelta);
                return (
                  <li key={e.id} className="flex items-center gap-3 text-sm">
                    <span className="grid size-7 shrink-0 place-items-center rounded-full bg-muted"><Icon name={ev.icon} className="size-3.5" /></span>
                    <div className="min-w-0 flex-1"><span className="font-medium">{ev.label}</span>{e.planName ? <span className="text-muted-foreground"> · {e.planName}</span> : ""}<span className="text-xs text-muted-foreground"> · {dt(e.at)}</span></div>
                    {d !== 0 && <span className={`shrink-0 tabular-nums ${d > 0 ? "text-emerald-600" : "text-destructive"}`}>{d > 0 ? "+" : "−"}{egp(Math.abs(d))}</span>}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent></Card>
      </div>

      {/* Collections history */}
      <Card><CardContent className="pt-6">
        <h3 className="mb-3 flex items-center gap-2 font-semibold"><Icon name="Receipt" className="size-4" />تاريخ التحصيلات</h3>
        {t.payments.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">لا تحصيلات مسجّلة لهذه المؤسسة.</p>
        ) : (
          <ul className="divide-y">
            {t.payments.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <div><span className="font-semibold tabular-nums">{egp(Number(p.amount))}</span> <Badge variant="secondary" className="ms-1">{METHOD[p.method] ?? p.method}</Badge></div>
                <div className="text-muted-foreground">{p.reference ? <span className="me-2 font-mono text-xs" dir="ltr">{p.reference}</span> : null}{dt(p.paidAt)}</div>
              </li>
            ))}
          </ul>
        )}
      </CardContent></Card>
    </div>
  );
}
