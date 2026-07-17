import { loadErpPage } from "@/lib/erp/org";
import { ErpPageHeader } from "@/components/erp/page-header";
import { CsvImportClient } from "@/components/erp/csv-import-client";
import { Card, CardContent } from "@/components/ui/card";
import { Icon } from "@/components/icon";
import { EXPORT_DATASETS, EXPORT_ORDER } from "@/lib/erp/export-datasets";

export default async function ImportExportPage() {
  return loadErpPage("sales.view", async ({ can }) => {
    const exportable = EXPORT_ORDER.filter((k) => can(EXPORT_DATASETS[k].module));

    return (
      <div className="space-y-8">
        <ErpPageHeader
          icon="ArrowRightLeft"
          title="الاستيراد والتصدير"
          subtitle="استيراد البيانات عبر CSV بقوالب جاهزة، وتصدير أي جدول إلى Excel أو PDF"
        />

        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Icon name="Upload" className="size-5 text-primary" />
            <h2 className="text-lg font-semibold">الاستيراد</h2>
          </div>
          <p className="text-sm text-muted-foreground">حمّل القالب، املأه، ثم ارفعه. الموجود (بنفس الكود) يُحدَّث دون المساس بالأرصدة.</p>
          <CsvImportClient />
        </section>

        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Icon name="Download" className="size-5 text-primary" />
            <h2 className="text-lg font-semibold">التصدير</h2>
          </div>
          <p className="text-sm text-muted-foreground">صدّر أي جدول إلى Excel (‎.xlsx‎) أو PDF (عبر الطباعة). البيانات كاملة حسب صلاحياتك.</p>
          <Card>
            <CardContent className="divide-y p-0">
              {exportable.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">لا توجد بيانات متاحة للتصدير بصلاحياتك.</div>
              ) : (
                exportable.map((k) => {
                  const ds = EXPORT_DATASETS[k];
                  return (
                    <div key={k} className="flex items-center gap-3 px-4 py-3">
                      <span className="flex-1 text-sm font-medium">{ds.title}</span>
                      <a
                        href={`/api/erp/exports/${k}`}
                        className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors hover:border-emerald-500 hover:bg-emerald-50 hover:text-emerald-700 dark:hover:bg-emerald-500/10"
                      >
                        <Icon name="Sheet" className="size-3.5" /> Excel
                      </a>
                      <a
                        href={`/erp/exports/${k}`}
                        target="_blank"
                        rel="noopener"
                        className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors hover:border-rose-500 hover:bg-rose-50 hover:text-rose-700 dark:hover:bg-rose-500/10"
                      >
                        <Icon name="FileText" className="size-3.5" /> PDF
                      </a>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>
        </section>
      </div>
    );
  });
}
