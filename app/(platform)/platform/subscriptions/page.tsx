import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/session";
import { getPlatformData, platformStats } from "@/lib/erp/platform-data";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { SubscriptionsCsvExport } from "@/components/platform/subscriptions-csv";

const money = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const intf  = (n: number) => n.toLocaleString("ar-EG-u-nu-latn");

const STATUS_CLS: Record<string, string> = {
  ACTIVE:    "bg-emerald-100 text-emerald-700",
  TRIAL:     "bg-blue-100 text-blue-700",
  EXPIRED:   "bg-amber-100 text-amber-700",
  CANCELLED: "bg-destructive/10 text-destructive",
  NONE:      "bg-muted text-muted-foreground",
};
const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "نشط", TRIAL: "تجريبي", EXPIRED: "منتهي", CANCELLED: "ملغى", NONE: "بدون",
};

export default async function SubscriptionsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/platform/login");
  if (user.role !== "system_admin") redirect("/dashboard");

  const { customers } = await getPlatformData();
  const s = platformStats(customers, []);

  const ORDER: Record<string, number> = { ACTIVE: 0, TRIAL: 1, EXPIRED: 2, CANCELLED: 3, NONE: 4 };
  const all = [...customers].sort((a, b) => (ORDER[a.status] ?? 9) - (ORDER[b.status] ?? 9));

  const kpis = [
    { label: "نشط",                   value: intf(s.active),        icon: "CircleCheck",   tone: "green"  as const },
    { label: "شهري",                   value: intf(s.monthly),       icon: "CalendarDays",  tone: "blue"   as const },
    { label: "سنوي",                   value: intf(s.annual),        icon: "CalendarRange", tone: "purple" as const },
    { label: "قرب الانتهاء",          value: intf(s.expiringSoon),  icon: "CalendarClock", tone: s.expiringSoon ? "yellow" as const : "slate" as const },
    { label: "ملغاة",                  value: intf(s.cancelled),     icon: "CircleX",       tone: s.cancelled ? "red" as const : "slate" as const },
    { label: "بدون ترخيص (وصول كامل)", value: intf(s.unlicensed),   icon: "ShieldAlert",   tone: s.unlicensed ? "yellow" as const : "slate" as const },
    { label: "MRR",                    value: money(s.mrr),          icon: "Wallet",        tone: "green"  as const },
    { label: "ARR",                    value: money(s.arr),          icon: "TrendingUp",    tone: "green"  as const },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="الاشتراكات" description="حالة الاشتراكات لكل عميل مرتّبةً حسب الأولوية.">
        <SubscriptionsCsvExport customers={all} />
      </PageHeader>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {kpis.map((k) => <StatCard key={k.label} label={k.label} value={k.value} icon={k.icon} tone={k.tone} />)}
      </div>

      <div className="rounded-xl border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b [&>th]:p-3 [&>th]:text-start">
                <th>العميل</th><th>الحالة</th><th>الخطة</th><th>الدورة</th>
                <th>السعر / الدورة</th><th>MRR المساهمة</th><th>بداية</th><th>انتهاء</th><th>متبقي</th>
              </tr>
            </thead>
            <tbody>
              {all.map((c) => {
                const mrrContrib = c.interval === "MONTHLY" ? c.price : c.interval === "ANNUAL" ? c.price / 12 : 0;
                return (
                  <tr key={c.id} className="border-b last:border-0 [&>td]:p-3 [&>td]:align-middle">
                    <td>
                      <Link href={`/platform/customers/${c.id}`} className="font-medium hover:underline">{c.name}</Link>
                      {c.email && <div className="text-xs text-muted-foreground" dir="ltr">{c.email}</div>}
                    </td>
                    <td>
                      <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", STATUS_CLS[c.status] ?? STATUS_CLS.NONE)}>
                        {STATUS_LABEL[c.status] ?? c.status}
                      </span>
                    </td>
                    <td className="text-xs">{c.planName ?? <span className="text-muted-foreground">—</span>}</td>
                    <td className="text-xs">{c.interval === "MONTHLY" ? "شهري" : c.interval === "ANNUAL" ? "سنوي" : <span className="text-muted-foreground">—</span>}</td>
                    <td className="tabular-nums text-xs">{c.price > 0 ? money(c.price) : <span className="text-muted-foreground">—</span>}</td>
                    <td className="tabular-nums text-xs font-semibold text-emerald-600">{mrrContrib > 0 ? money(mrrContrib) : <span className="font-normal text-muted-foreground">—</span>}</td>
                    <td className="tabular-nums text-xs text-muted-foreground">{c.startedAt ? new Date(c.startedAt).toLocaleDateString("en-GB") : <span>—</span>}</td>
                    <td className="tabular-nums text-xs">
                      {c.expiresAt ? new Date(c.expiresAt).toLocaleDateString("en-GB") : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="text-xs">
                      {c.daysLeft != null && c.live ? (
                        <Badge variant="outline" className={cn("text-[10px]", c.daysLeft <= 7 ? "border-red-300 text-red-600" : c.daysLeft <= 30 ? "border-amber-300 text-amber-600" : "border-emerald-300 text-emerald-600")}>
                          {c.daysLeft} يوم
                        </Badge>
                      ) : <span className="text-muted-foreground">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
