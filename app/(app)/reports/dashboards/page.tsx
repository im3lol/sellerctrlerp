import Link from "next/link";
import { fill } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";
import { and, asc, eq, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { dashboards } from "@/db/schema";
import { loadErpPage } from "@/lib/erp/org";
import { requireUser } from "@/lib/session";
import { ErpPageHeader } from "@/components/erp/page-header";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/icon";
import { NewDashboardButton } from "@/components/erp/dashboard-editor";

export const dynamic = "force-dynamic";

export default async function DashboardsPage() {
  const t = await getT();
  return loadErpPage("reports.view", async ({ orgId }) => {
    const user = await requireUser();
    // The caller's own dashboards plus anything shared with the org.
    const rows = await db
      .select({ id: dashboards.id, number: dashboards.number, nameAr: dashboards.nameAr, widgets: dashboards.widgets, isShared: dashboards.isShared, createdBy: dashboards.createdBy })
      .from(dashboards)
      .where(and(eq(dashboards.organizationId, orgId), or(eq(dashboards.isShared, true), eq(dashboards.createdBy, user.id))))
      .orderBy(asc(dashboards.nameAr));

    return (
      <div className="space-y-6">
        <ErpPageHeader
          icon="LayoutDashboard"
          title={t("لوحات التقارير")}
          subtitle={t("جمّع تقاريرك المحفوظة ورسوماتها في صفحة واحدة — الأرقام بتتقرا من جديد كل مرة تفتحها")}
          backHref="/reports/center"
          action={<NewDashboardButton />}
        />

        {rows.length === 0 ? (
          <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
            {t("مفيش لوحات لسه. احفظ تقرير من")} <Link href="/reports/builder" className="text-primary underline">{t("باني التقارير")}</Link> {t("(مع رسم لو حابب)، وبعدين اعمل لوحة وضيفه فيها.")}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map((d) => (
              <Link key={d.id} href={`/reports/dashboards/${encodeURIComponent(d.number)}`}
                className="flex items-start gap-3 rounded-2xl border p-4 transition-colors hover:border-primary">
                <Icon name="LayoutDashboard" className="mt-0.5 size-5 text-primary" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium">{t(d.nameAr)}</span>
                    {d.isShared && <Badge variant="outline" className="text-xs">{t("مشتركة")}</Badge>}
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    {fill(t("{0} تقرير"), [d.widgets.length.toLocaleString("ar-EG-u-nu-latn")])}{d.createdBy && d.createdBy !== user.id ? t(" · من زميل") : ""}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    );
  });
}
