import { withPlatformScope } from "@/lib/db-scope";
import Link from "next/link";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { Icon } from "@/components/icon";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";

const int = (n: number) => n.toLocaleString("ar-EG");

const SECTIONS = [
  { label: "الباقات", desc: "خطط الاشتراك: الوحدات وحدود المستخدمين والتخزين والأسعار.", href: "/admin/plans", icon: "Package" },
  { label: "المؤسسات والاشتراكات", desc: "الاشتراكات، الاستهلاك، طلبات التفعيل والانتهاء.", href: "/admin/licensing", icon: "Building2" },
  { label: "كوبونات الخصم", desc: "أكواد خصم تُطبَّق على سعر الاشتراك.", href: "/admin/coupons", icon: "Ticket" },
  { label: "أدوات النظام", desc: "حالة الخادم وقاعدة البيانات والتخزين المستهلك.", href: "/admin/system", icon: "Server" },
] as const;

export default async function AdminHome() {
  return withPlatformScope(async () => {
    const [row] = await db.execute<{ orgs: number; pending: number; active: number; trial: number; revenue: string; coupons: number }>(sql`
      SELECT
        (SELECT count(*)::int FROM organizations) AS orgs,
        (SELECT count(*)::int FROM subscription_requests WHERE status='PENDING') AS pending,
        (SELECT count(*)::int FROM org_subscriptions WHERE status='ACTIVE') AS active,
        (SELECT count(*)::int FROM org_subscriptions WHERE status='TRIAL') AS trial,
        (SELECT coalesce(sum(price),0) FROM org_subscriptions WHERE status='ACTIVE') AS revenue,
        (SELECT count(*)::int FROM discount_coupons WHERE is_active) AS coupons
    `).then((r) => r.rows);

    const stats = [
      { label: "المؤسسات", value: int(Number(row?.orgs ?? 0)), icon: "Building2" },
      { label: "اشتراكات مفعّلة", value: int(Number(row?.active ?? 0)), icon: "BadgeCheck", hint: `${int(Number(row?.trial ?? 0))} تجريبي` },
      { label: "إيراد الاشتراكات", value: Number(row?.revenue ?? 0).toLocaleString("ar-EG"), icon: "Coins" },
      { label: "طلبات معلّقة", value: int(Number(row?.pending ?? 0)), icon: "Clock", hint: Number(row?.pending ?? 0) > 0 ? "تحتاج مراجعة" : undefined },
      { label: "كوبونات فعّالة", value: int(Number(row?.coupons ?? 0)), icon: "Ticket" },
    ];

    return (
      <div className="space-y-6">
        <PageHeader title="لوحة الإدارة" description="إدارة المؤسسات والاشتراكات والمستخدمين — منفصلة عن الاستخدام اليومي للـ ERP." />

        <div className="grid gap-4 grid-cols-2 lg:grid-cols-5">
          {stats.map((s) => (
            <Card key={s.label}><CardContent className="pt-6">
              <div className="flex items-center gap-2 text-sm text-muted-foreground"><Icon name={s.icon} className="size-4" />{s.label}</div>
              <div className="text-2xl font-bold tabular-nums">{s.value}</div>
              {s.hint && <div className="text-xs text-muted-foreground">{s.hint}</div>}
            </CardContent></Card>
          ))}
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
