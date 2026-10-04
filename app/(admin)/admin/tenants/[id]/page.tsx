import Link from "next/link";
import { fill, type Locale } from "@/lib/i18n";
import { getLocale, getT } from "@/lib/i18n/server";
import { notFound } from "next/navigation";
import { getTenantDetail } from "@/lib/erp/tenant-detail";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/icon";
import { Progress } from "@/components/ui/progress";
import { TenantActions } from "@/components/admin/tenant-actions";
import { NoonExpressToggle } from "@/components/admin/noon-express-toggle";

const egp = (n: number, locale: Locale) => (locale === "en" ? `${Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 })} EGP` : `${Number(n).toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 0 })} ج.م`);
const dt = (d: Date | null, locale: Locale) => (d ? new Date(d).toLocaleDateString((locale === "en" ? "en-GB" : "ar-EG-u-nu-latn"), { year: "numeric", month: "short", day: "numeric" }) : "—");
const fmtBytes = (b: number, locale: Locale) => {
  const [kb, mb, gb] = locale === "en" ? ["KB", "MB", "GB"] : ["ك.ب", "م.ب", "ج.ب"];
  return b < 1024 * 1024 ? `${(b / 1024).toFixed(0)} ${kb}` : b < 1024 ** 3 ? `${(b / 1024 / 1024).toFixed(1)} ${mb}` : `${(b / 1024 ** 3).toFixed(2)} ${gb}`;
};
const int = (n: number) => n.toLocaleString("ar-EG-u-nu-latn");

const EVENT: Record<string, { label: string; icon: string }> = {
  ACTIVATED: { label: "تفعيل", icon: "BadgeCheck" }, RENEWED: { label: "تجديد", icon: "RefreshCw" },
  UPGRADED: { label: "ترقية", icon: "TrendingUp" }, DOWNGRADED: { label: "تخفيض", icon: "TrendingDown" },
  EXPIRED: { label: "انتهاء", icon: "CircleAlert" }, CANCELLED: { label: "إلغاء", icon: "CircleX" },
};
const EVENT_EN: Record<string, string> = { ACTIVATED: "Activation", RENEWED: "Renewal", UPGRADED: "Upgrade", DOWNGRADED: "Downgrade", EXPIRED: "Expiry", CANCELLED: "Cancellation" };
const HEALTH: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  healthy: { label: "نشط سليم", variant: "default" }, at_risk: { label: "معرّض للخطر", variant: "destructive" },
  expired: { label: "منتهٍ", variant: "destructive" }, trial: { label: "تجريبي", variant: "secondary" },
};
const METHOD: Record<string, string> = { INSTAPAY: "إنستاباي", BANK: "تحويل بنكي", VISA: "فيزا", CASH: "نقدًا", OTHER: "أخرى" };

export default async function TenantPage({ params }: { params: Promise<{ id: string }> }) {
  const locale = await getLocale();
  const { id } = await params;
  const t = await getT();
  const d = await getTenantDetail(id);
  if (!d) notFound();
  const h = HEALTH[d.health] ?? HEALTH.trial;
  const pct = (n: number, cap: number | null) => (cap && cap > 0 ? Math.min(100, Math.round((n / cap) * 100)) : null);
  const seatPct = pct(d.usage.members, d.usage.maxUsers);
  const storagePct = pct(d.usage.storageBytes, d.usage.storageGb ? d.usage.storageGb * 1024 ** 3 : null);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader title={d.org.name} description={fill(t("عميل منذ {0}"), [dt(d.org.createdAt, locale)]) + (d.org.email ? ` · ${d.org.email}` : "") + (d.org.signupSource ? fill(t(" · المصدر: {0}"), [d.org.signupSource]) : "")} />
        <Link href="/admin/licensing" className="text-sm text-muted-foreground hover:text-foreground">{t("← كل المؤسسات")}</Link>
      </div>

      {/* KPI row */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <Card className="border-primary/40 bg-primary/5"><CardContent className="pt-6">
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Icon name="TrendingUp" className="size-4" />{t("الإيراد الشهري")}</div>
          <div className="mt-1 text-2xl font-bold tabular-nums">{egp(d.mrr, locale)}</div>
        </CardContent></Card>
        <Card><CardContent className="pt-6">
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Icon name="Activity" className="size-4" />{t("الحالة")}</div>
          <div className="mt-1"><Badge variant={h.variant}>{t(h.label)}</Badge></div>
          <div className="mt-1 text-xs text-muted-foreground">{d.sub?.planName ?? t("بلا باقة")}{d.daysLeft != null ? ` · ${d.daysLeft <= 0 ? t("منتهٍ") : fill(t("{0} يوم"), [int(d.daysLeft)])}` : ""}</div>
        </CardContent></Card>
        <Card><CardContent className="pt-6">
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Icon name="Wallet" className="size-4" />{t("إجمالي المُحصّل")}</div>
          <div className="mt-1 text-2xl font-bold tabular-nums">{egp(d.collectedTotal, locale)}</div>
        </CardContent></Card>
        <Card><CardContent className="pt-6">
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Icon name="Clock" className="size-4" />{t("آخر نشاط")}</div>
          <div className="mt-1 text-lg font-semibold">{dt(d.lastActivityAt, locale)}</div>
        </CardContent></Card>
      </div>

      <TenantActions orgId={d.org.id} orgName={d.org.name} />
      <NoonExpressToggle orgId={d.org.id} noon={d.noon} />

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Usage */}
        <Card><CardContent className="space-y-4 pt-6">
          <h3 className="flex items-center gap-2 font-semibold"><Icon name="Gauge" className="size-4" />{t("الاستهلاك")}</h3>
          <div>
            <div className="mb-1 flex justify-between text-sm"><span className="text-muted-foreground">{t("المستخدمون")}</span><span className="tabular-nums">{int(d.usage.members)}{d.usage.maxUsers != null ? ` / ${int(d.usage.maxUsers)}` : " / ∞"}</span></div>
            {seatPct != null && <Progress value={seatPct} />}
          </div>
          <div>
            <div className="mb-1 flex justify-between text-sm"><span className="text-muted-foreground">{t("التخزين")}</span><span className="tabular-nums">{fmtBytes(d.usage.storageBytes, locale)}{d.usage.storageGb != null ? " / " + fill(t("{0} ج.ب"), [d.usage.storageGb]) : ""}</span></div>
            {storagePct != null && <Progress value={storagePct} />}
          </div>
          <div className="flex justify-between border-t pt-2 text-sm"><span className="text-muted-foreground">{t("الوحدات المفعّلة")}</span><span className="tabular-nums">{d.sub?.enabledModules?.length ?? 0}</span></div>
        </CardContent></Card>

        {/* Subscription timeline */}
        <Card className="lg:col-span-2"><CardContent className="pt-6">
          <h3 className="mb-3 flex items-center gap-2 font-semibold"><Icon name="History" className="size-4" />{t("سجل الاشتراك")}</h3>
          {d.events.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t("لا أحداث بعد (يتجمّع من وقت التفعيل).")}</p>
          ) : (
            <ul className="space-y-2.5">
              {d.events.map((e) => {
                const ev = EVENT[e.type] ?? { label: e.type, icon: "Circle" };
                const d = Number(e.mrrDelta);
                return (
                  <li key={e.id} className="flex items-center gap-3 text-sm">
                    <span className="grid size-7 shrink-0 place-items-center rounded-full bg-muted"><Icon name={ev.icon} className="size-3.5" /></span>
                    <div className="min-w-0 flex-1"><span className="font-medium">{locale === "en" ? EVENT_EN[e.type] ?? ev.label : t(ev.label)}</span>{e.planName ? <span className="text-muted-foreground"> · {e.planName}</span> : ""}<span className="text-xs text-muted-foreground"> · {dt(e.at, locale)}</span></div>
                    {d !== 0 && <span className={`shrink-0 tabular-nums ${d > 0 ? "text-emerald-600" : "text-destructive"}`}>{d > 0 ? "+" : "−"}{egp(Math.abs(d), locale)}</span>}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent></Card>
      </div>

      {/* Stored backups */}
      <Card><CardContent className="pt-6">
        <h3 className="mb-3 flex items-center gap-2 font-semibold"><Icon name="DatabaseBackup" className="size-4" />{t("النسخ الاحتياطية المخزّنة")}</h3>
        {d.backups.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t("لا نسخ مخزّنة بعد — الكرون اليومي بيعمل نسخة تلقائيًا، أو استخدم زر «نسخة احتياطية» بالأعلى.")}</p>
        ) : (
          <ul className="divide-y">
            {d.backups.map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <div><span className="font-medium">{dt(b.createdAt, locale)}</span> <Badge variant="secondary" className="ms-1">{b.kind === "MANUAL" ? t("يدوي") : t("تلقائي")}</Badge> <span className="text-xs text-muted-foreground">{int(b.totalRows)} {t("صف ·")} {fmtBytes(b.sizeBytes, locale)}</span></div>
                <a href={`/admin/tenants/${d.org.id}/backups/${b.id}`} className="text-primary hover:underline">{t("تنزيل")}</a>
              </li>
            ))}
          </ul>
        )}
      </CardContent></Card>

      {/* Collections history */}
      <Card><CardContent className="pt-6">
        <h3 className="mb-3 flex items-center gap-2 font-semibold"><Icon name="Receipt" className="size-4" />{t("تاريخ التحصيلات")}</h3>
        {d.payments.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t("لا تحصيلات مسجّلة لهذه المؤسسة.")}</p>
        ) : (
          <ul className="divide-y">
            {d.payments.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <div><span className="font-semibold tabular-nums">{egp(Number(p.amount), locale)}</span> <Badge variant="secondary" className="ms-1">{t(METHOD[p.method] ?? p.method)}</Badge></div>
                <div className="text-muted-foreground">{p.reference ? <span className="me-2 font-mono text-xs" dir="ltr">{p.reference}</span> : null}{dt(p.paidAt, locale)}</div>
              </li>
            ))}
          </ul>
        )}
      </CardContent></Card>
    </div>
  );
}
