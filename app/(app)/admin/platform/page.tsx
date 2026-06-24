import { redirect } from "next/navigation";
import { asc, desc } from "drizzle-orm";
import { requireUser } from "@/lib/session";
import { db } from "@/lib/db";
import { organizations, orgSubscriptions, activationCodes } from "@/db/schema";
import { ALL_MODULES, MODULE_LABELS } from "@/lib/erp/entitlements";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { LicensingManager, type CustomerRow, type CodeRow } from "@/components/admin/licensing-manager";

const intf = (n: number) => n.toLocaleString("ar-EG-u-nu-latn");
const DAY = 86_400_000;

export default async function PlatformAdminPage() {
  const user = await requireUser();
  if (user.role !== "system_admin") redirect("/dashboard");

  const [orgs, subs, codes] = await Promise.all([
    db.select({ id: organizations.id, nameAr: organizations.nameAr, email: organizations.email, createdAt: organizations.createdAt })
      .from(organizations).orderBy(asc(organizations.createdAt)),
    db.select().from(orgSubscriptions),
    db.select().from(activationCodes).orderBy(desc(activationCodes.createdAt)),
  ]);

  const subByOrg = new Map(subs.map((s) => [s.organizationId, s]));
  const now = Date.now();

  const customers: CustomerRow[] = orgs.map((o) => {
    const s = subByOrg.get(o.id);
    const expiresAt = s?.expiresAt ? new Date(s.expiresAt).getTime() : null;
    const live = !!s && (s.status === "ACTIVE" || s.status === "TRIAL") && (!expiresAt || expiresAt > now);
    return {
      id: o.id,
      name: o.nameAr,
      email: o.email ?? null,
      status: s?.status ?? "NONE",
      interval: s?.interval ?? null,
      planName: s?.planName ?? null,
      modules: s?.enabledModules ?? [],
      expiresAt: s?.expiresAt ? new Date(s.expiresAt).toISOString() : null,
      daysLeft: expiresAt ? Math.ceil((expiresAt - now) / DAY) : null,
      live,
    };
  });

  const codeRows: CodeRow[] = codes.map((c) => ({
    id: c.id,
    hint: c.codeHint,
    interval: c.interval,
    durationMonths: c.durationMonths,
    modules: c.enabledModules ?? [],
    planName: c.planName ?? null,
    status: c.status,
    orgName: c.organizationId ? (orgs.find((o) => o.id === c.organizationId)?.nameAr ?? "—") : null,
    redeemedAt: c.redeemedAt ? new Date(c.redeemedAt).toISOString() : null,
    createdAt: new Date(c.createdAt).toISOString(),
  }));

  const activeSubs = customers.filter((c) => c.live);
  const expiringSoon = activeSubs.filter((c) => c.daysLeft != null && c.daysLeft <= 30).length;
  const monthly = activeSubs.filter((c) => c.interval === "MONTHLY").length;
  const annual = activeSubs.filter((c) => c.interval === "ANNUAL").length;
  const cancelled = customers.filter((c) => c.status === "CANCELLED").length;
  const codesUnused = codes.filter((c) => c.status === "UNUSED").length;

  const kpis = [
    { label: "العملاء", value: intf(orgs.length), icon: "Building2", tone: "blue" as const },
    { label: "اشتراكات نشطة", value: intf(activeSubs.length), icon: "CircleCheck", tone: "green" as const },
    { label: "تقارب الانتهاء (٣٠ يوم)", value: intf(expiringSoon), icon: "CalendarClock", tone: expiringSoon ? ("yellow" as const) : ("slate" as const) },
    { label: "شهري / سنوي", value: `${intf(monthly)} / ${intf(annual)}`, icon: "Repeat", tone: "purple" as const },
    { label: "ملغاة", value: intf(cancelled), icon: "CircleX", tone: cancelled ? ("red" as const) : ("slate" as const) },
    { label: "أكواد غير مستخدمة", value: intf(codesUnused), icon: "KeyRound", tone: "slate" as const },
  ];

  const moduleOptions = ALL_MODULES.map((m) => ({ key: m, label: MODULE_LABELS[m] }));

  return (
    <div className="space-y-6">
      <PageHeader title="لوحة المالك — الاشتراكات والتفعيل" description="إدارة العملاء، أكواد التفعيل المشفّرة، والموديولات المتاحة لكل عميل." />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
        {kpis.map((k) => <StatCard key={k.label} label={k.label} value={k.value} icon={k.icon} tone={k.tone} />)}
      </div>

      <LicensingManager customers={customers} codes={codeRows} moduleOptions={moduleOptions} />
    </div>
  );
}
