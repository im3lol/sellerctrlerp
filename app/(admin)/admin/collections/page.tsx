import { withPlatformScope } from "@/lib/db-scope";
import { asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { organizations } from "@/db/schema";
import { getCollectionsSummary } from "@/lib/erp/platform-metrics";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Icon } from "@/components/icon";
import { CollectionsManager } from "@/components/admin/collections-manager";

const egp = (n: number) => `${Number(n).toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 0 })} ج.م`;

export default async function CollectionsPage() {
  return withPlatformScope(async () => {
    const orgs = await db.select({ id: organizations.id, name: organizations.nameAr }).from(organizations).orderBy(asc(organizations.nameAr));
    const s = await getCollectionsSummary();

    const stats = [
      { label: "محصّل هذا الشهر", value: egp(s.thisMonth), icon: "Wallet", accent: true },
      { label: "إجمالي التحصيلات", value: egp(s.allTime), icon: "Coins" },
      { label: "عدد المؤسسات", value: orgs.length.toLocaleString("ar-EG-u-nu-latn"), icon: "Building2" },
    ];

    return (
      <div className="space-y-6">
        <PageHeader title="التحصيلات" description="تسجيل ما استلمته من المؤسسات مقابل اشتراكاتها (الإيراد الفعلي المُحصّل)." />
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
          {stats.map((s) => (
            <Card key={s.label} className={s.accent ? "border-primary/40 bg-primary/5" : undefined}><CardContent className="pt-6">
              <div className="flex items-center gap-2 text-sm text-muted-foreground"><Icon name={s.icon} className="size-4" />{s.label}</div>
              <div className="mt-1 text-2xl font-bold tabular-nums">{s.value}</div>
            </CardContent></Card>
          ))}
        </div>
        <CollectionsManager orgs={orgs} rows={s.recent.map((r) => ({ ...r, paidAt: r.paidAt.toISOString() }))} />
      </div>
    );
  });
}
