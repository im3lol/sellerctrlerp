import Link from "next/link";
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
  return loadErpPage("reports.view", async ({ orgId }) => {
    const user = await requireUser();
    // The caller's own dashboards plus anything shared with the org.
    const rows = await db
      .select({ id: dashboards.id, nameAr: dashboards.nameAr, widgets: dashboards.widgets, isShared: dashboards.isShared, createdBy: dashboards.createdBy })
      .from(dashboards)
      .where(and(eq(dashboards.organizationId, orgId), or(eq(dashboards.isShared, true), eq(dashboards.createdBy, user.id))))
      .orderBy(asc(dashboards.nameAr));

    return (
      <div className="space-y-6">
        <ErpPageHeader
          icon="LayoutDashboard"
          title="لوحات التقارير"
          subtitle="جمّع تقاريرك المحفوظة ورسوماتها في صفحة واحدة — الأرقام بتتقرا من جديد كل مرة تفتحها"
          backHref="/reports/center"
          action={<NewDashboardButton />}
        />

        {rows.length === 0 ? (
          <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
            مفيش لوحات لسه. احفظ تقرير من <Link href="/reports/builder" className="text-primary underline">باني التقارير</Link> (مع رسم لو حابب)، وبعدين اعمل لوحة وضيفه فيها.
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map((d) => (
              <Link key={d.id} href={`/reports/dashboards/${d.id}`}
                className="flex items-start gap-3 rounded-2xl border p-4 transition-colors hover:border-primary">
                <Icon name="LayoutDashboard" className="mt-0.5 size-5 text-primary" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium">{d.nameAr}</span>
                    {d.isShared && <Badge variant="outline" className="text-xs">مشتركة</Badge>}
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    {d.widgets.length.toLocaleString("ar-EG-u-nu-latn")} تقرير{d.createdBy && d.createdBy !== user.id ? " · من زميل" : ""}
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
