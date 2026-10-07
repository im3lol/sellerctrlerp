import Link from "next/link";
import type { Locale } from "@/lib/i18n";
import { getLocale, getT } from "@/lib/i18n/server";
import { withPlatformScope } from "@/lib/db-scope";
import { getAdminActivity } from "@/lib/erp/platform-metrics";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Icon } from "@/components/icon";

const egp = (n: number, locale: Locale) => (locale === "en" ? `${Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 })} EGP` : `${Number(n).toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 0 })} ج.م`);
const dtt = (d: Date, locale: Locale) => new Date(d).toLocaleString((locale === "en" ? "en-GB" : "ar-EG-u-nu-latn"), { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

const KIND: Record<string, { icon: string; cls: string }> = {
  impersonate: { icon: "LogIn", cls: "bg-amber-500/15 text-amber-600" },
  collection: { icon: "Wallet", cls: "bg-emerald-500/15 text-emerald-600" },
  subscription: { icon: "RefreshCw", cls: "bg-primary/15 text-primary" },
};

export default async function ActivityPage() {
  const locale = await getLocale();
  const t = await getT();
  return withPlatformScope(async () => {
    const items = await getAdminActivity(60);
    return (
      <div className="space-y-6">
        <PageHeader title={t("سجل النشاط")} description={t("أحداث المنصّة القابلة للتدقيق — دخول الدعم، التحصيلات، وتغييرات الاشتراكات عبر كل المؤسسات.")} />
        <Card><CardContent className="pt-6">
          {items.length === 0 ? (
            <p className="py-10 text-center text-muted-foreground">{t("لا نشاط بعد.")}</p>
          ) : (
            <ul className="space-y-3">
              {items.map((it, i) => {
                const k = KIND[it.kind] ?? KIND.subscription;
                return (
                  <li key={i} className="flex items-start gap-3">
                    <span className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-full ${k.cls}`}><Icon name={k.icon} className="size-4" /></span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
                        <span className="font-medium">{t(it.label)}</span>
                        <Link href={`/admin/tenants/${it.orgId}`} className="text-muted-foreground hover:text-primary hover:underline">{it.orgName}</Link>
                        {it.amount != null && it.amount !== 0 && (
                          <span className={`tabular-nums ${it.amount > 0 ? "text-emerald-600" : "text-destructive"}`}>{it.amount > 0 ? "+" : "−"}{egp(Math.abs(it.amount), locale)}</span>
                        )}
                      </div>
                      {it.detail && <div className="truncate text-xs text-muted-foreground">{it.detail}</div>}
                    </div>
                    <time className="shrink-0 text-xs text-muted-foreground tabular-nums">{dtt(it.at, locale)}</time>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent></Card>
      </div>
    );
  });
}
