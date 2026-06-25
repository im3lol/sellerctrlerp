import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { getPlatformData, platformStats } from "@/lib/erp/platform-data";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";

const intf  = (n: number) => n.toLocaleString("ar-EG-u-nu-latn");
const money = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default async function PlatformOverviewPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/platform/login");
  if (user.role !== "system_admin") redirect("/dashboard");

  const { customers, codes } = await getPlatformData();
  const s = platformStats(customers, codes);

  const kpis = [
    { label: "إجمالي العملاء",           value: intf(s.customers),    icon: "Building2",    tone: "blue"   as const },
    { label: "اشتراكات نشطة",            value: intf(s.active),       icon: "CircleCheck",  tone: "green"  as const },
    { label: "الإيراد الشهري (MRR)",     value: money(s.mrr),         icon: "Wallet",       tone: "green"  as const },
    { label: "الإيراد السنوي (ARR)",     value: money(s.arr),         icon: "TrendingUp",   tone: "green"  as const },
    { label: "تقارب الانتهاء (٣٠ يوم)",  value: intf(s.expiringSoon), icon: "CalendarClock",tone: s.expiringSoon ? "yellow" as const : "slate" as const },
    { label: "بدون ترخيص (وصول كامل)",   value: intf(s.unlicensed),   icon: "ShieldAlert",  tone: s.unlicensed ? "yellow" as const : "slate" as const },
    { label: "ملغاة",                    value: intf(s.cancelled),    icon: "CircleX",      tone: s.cancelled ? "red" as const : "slate" as const },
    { label: "أكواد غير مستخدمة",        value: intf(s.codesUnused),  icon: "KeyRound",     tone: "slate"  as const },
  ];

  // Active customers with revenue for the quick summary table
  const active = customers.filter((c) => c.live);

  return (
    <div className="space-y-6">
      <PageHeader
        title="نظرة عامة"
        description="مؤشرات المنصّة، الاشتراكات، والإيراد لحظة بلحظة."
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {kpis.map((k) => (
          <StatCard key={k.label} label={k.label} value={k.value} icon={k.icon} tone={k.tone} />
        ))}
      </div>

      {/* Active subscriptions quick view */}
      {active.length > 0 && (
        <div className="rounded-xl border bg-card p-5">
          <h2 className="mb-4 text-sm font-semibold">الاشتراكات النشطة</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr className="border-b [&>th]:p-2 [&>th]:text-start">
                  <th>العميل</th><th>الخطة</th><th>الدورة</th><th>السعر / الدورة</th><th>MRR</th><th>الانتهاء</th>
                </tr>
              </thead>
              <tbody>
                {active.map((c) => {
                  const mrrContrib = c.interval === "MONTHLY" ? c.price : c.interval === "ANNUAL" ? c.price / 12 : 0;
                  return (
                    <tr key={c.id} className="border-b [&>td]:p-2 [&>td]:align-middle">
                      <td className="font-medium">{c.name}</td>
                      <td className="text-xs text-muted-foreground">{c.planName ?? "—"}</td>
                      <td className="text-xs">{c.interval === "MONTHLY" ? "شهري" : c.interval === "ANNUAL" ? "سنوي" : "—"}</td>
                      <td className="tabular-nums text-xs">{c.price > 0 ? money(c.price) : "—"}</td>
                      <td className="tabular-nums text-xs font-medium text-emerald-600">{money(mrrContrib)}</td>
                      <td className="tabular-nums text-xs">
                        {c.expiresAt ? new Date(c.expiresAt).toLocaleDateString("en-GB") : "—"}
                        {c.daysLeft != null && c.daysLeft <= 30 && <span className="ms-1 text-amber-600">({c.daysLeft}ي)</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
