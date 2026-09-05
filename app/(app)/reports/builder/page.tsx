import { loadErpPage } from "@/lib/erp/org";
import { EXPORT_DATASETS } from "@/lib/erp/export-datasets";
import { ErpPageHeader } from "@/components/erp/page-header";
import { ReportBuilderUI } from "@/components/erp/report-builder-ui";
import { listSavedReportsAction } from "@/app/actions/erp/report-builder";

export const dynamic = "force-dynamic";

export default async function ReportBuilderPage() {
  return loadErpPage("reports.view", async ({ can }) => {
    // Only datasets this user could already export — the builder grants no new access.
    const datasets = Object.entries(EXPORT_DATASETS)
      .filter(([, ds]) => can(ds.module))
      .map(([key, ds]) => ({ key, title: ds.title, headers: ds.headers }));

    const saved = await listSavedReportsAction();

    return (
      <div className="space-y-6">
        <ErpPageHeader
          icon="Table2"
          title="باني التقارير"
          subtitle="اختار بيانات، فلتر، جمّع، واحفظ السؤال — الأرقام بتتقرا من جديد كل مرة"
          backHref="/reports/center"
        />
        {datasets.length === 0 ? (
          <p className="text-sm text-muted-foreground">مفيش بيانات متاحة لصلاحياتك.</p>
        ) : (
          <ReportBuilderUI
            datasets={datasets}
            saved={(saved.rows ?? []).filter((r) => datasets.some((d) => d.key === r.dataset))}
          />
        )}
      </div>
    );
  });
}
