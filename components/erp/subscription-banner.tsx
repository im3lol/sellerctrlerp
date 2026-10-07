import Link from "next/link";
import { fill } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";
import type { getSubscriptionState } from "@/lib/erp/subscription";

type Sub = Awaited<ReturnType<typeof getSubscriptionState>> | null;

/**
 * Trial running out, suspended, or expired. Shown on the apps page (where everyone lands)
 * and on the dashboard; nothing at all for a company in good standing.
 */
export async function SubscriptionBanner({ sub }: { sub: Sub }) {
  const t = await getT();
  const b = sub && sub.isTrial
    ? { cls: "border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-400", text: fill(t("الفترة التجريبية — متبقٍ {0} يوم. اشترك الآن للاستمرار."), [sub.daysLeft]) }
    : sub && sub.status === "SUSPENDED"
    ? { cls: "border-destructive/40 bg-destructive/5 text-destructive", text: "تم إيقاف اشتراكك مؤقتًا — تواصل مع الدعم لإعادة التفعيل." }
    : sub && !sub.live
    ? { cls: "border-destructive/40 bg-destructive/5 text-destructive", text: "انتهت فترة وصولك — اختر باقة لتفعيل النظام." }
    : null;
  if (!b) return null;
  return (
    <Link href="/settings/subscription" className={`flex items-center justify-between rounded-2xl border p-4 ${b.cls}`}>
      <span className="text-sm font-medium">{t(b.text)}</span>
      <span className="text-sm underline">{t("إدارة الاشتراك ←")}</span>
    </Link>
  );
}
