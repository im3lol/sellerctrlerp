import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { getPlatformData, platformStats } from "@/lib/erp/platform-data";
import { ALL_MODULES, MODULE_LABELS } from "@/lib/erp/entitlements";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { CodesManager } from "@/components/admin/licensing-manager";

const intf = (n: number) => n.toLocaleString("ar-EG-u-nu-latn");

export default async function CodesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/platform/login");
  if (user.role !== "system_admin") redirect("/dashboard");

  const { customers, codes } = await getPlatformData();
  const s = platformStats(customers, codes);
  const moduleOptions = ALL_MODULES.map((m) => ({ key: m, label: MODULE_LABELS[m] }));

  const kpis = [
    { label: "إجمالي الأكواد",    value: intf(s.codesTotal),  icon: "KeyRound",    tone: "slate"  as const },
    { label: "غير مستخدمة",       value: intf(s.codesUnused), icon: "Key",         tone: "blue"   as const },
    { label: "مستخدمة",           value: intf(s.codesTotal - s.codesUnused), icon: "CheckSquare", tone: "green" as const },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="أكواد التفعيل"
        description="كل الأكواد المشفّرة — مخزّنة كبصمة فقط، تُعرض مرة واحدة عند التوليد."
      />

      <div className="grid grid-cols-3 gap-4">
        {kpis.map((k) => <StatCard key={k.label} label={k.label} value={k.value} icon={k.icon} tone={k.tone} />)}
      </div>

      <CodesManager codes={codes} moduleOptions={moduleOptions} />
    </div>
  );
}
