import { and, desc, eq, gte } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { reportDownloads } from "@/db/schema";
import { REPORT_MODULES } from "@/lib/erp/report-catalog";
import { ErpPageHeader } from "@/components/erp/page-header";
import { ReportGenerator } from "@/components/erp/report-generator";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/icon";

const dt = (d: Date) => new Date(d).toLocaleString("ar-EG-u-nu-latn", { dateStyle: "medium", timeStyle: "short" });

// Flat lookup: report key → {view, excel} for rebuilding a re-download link.
const CATALOG = new Map(REPORT_MODULES.flatMap((m) => m.reports).map((r) => [r.key, r]));

/** Re-download link for a stored history row (regenerates from params). */
function downloadHref(key: string, format: string, params: string): { href: string; blank: boolean } | null {
  const r = CATALOG.get(key);
  if (!r) return null;
  if (format === "excel" && r.excel) return { href: r.excel + (params ? `?${params}` : ""), blank: false };
  const sep = params ? `${params}&` : "";
  return { href: `${r.view}?${sep}print=1`, blank: true };
}

export default async function ReportsCenterPage() {
  return loadErpPage("reports.view", async ({ orgId }) => {
    // Recent downloads (kept ~1 week).
    const weekAgo = new Date(Date.now() - 7 * 864e5);
    const recent = await db
      .select({ id: reportDownloads.id, reportKey: reportDownloads.reportKey, label: reportDownloads.label, format: reportDownloads.format, params: reportDownloads.params, createdAt: reportDownloads.createdAt })
      .from(reportDownloads)
      .where(and(eq(reportDownloads.organizationId, orgId), gte(reportDownloads.createdAt, weekAgo)))
      .orderBy(desc(reportDownloads.createdAt))
      .limit(25);

    return (
      <div className="mx-auto max-w-4xl space-y-6">
        <ErpPageHeader icon="ChartColumn" title="مركز التقارير" subtitle="اختر الموديول ثم التقرير والفترة والصيغة — واستخرجه PDF أو Excel" />
        <ReportGenerator />

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Icon name="History" className="size-5 text-primary" />آخر التقارير المُحمّلة</CardTitle>
            <CardDescription>متاحة لإعادة التحميل خلال أسبوع من إنشائها.</CardDescription>
          </CardHeader>
          <CardContent>
            {recent.length === 0 ? (
              <div className="rounded-xl border border-dashed py-10 text-center text-sm text-muted-foreground">لم تُحمّل أي تقارير بعد.</div>
            ) : (
              <ul className="divide-y">
                {recent.map((r) => {
                  const dl = downloadHref(r.reportKey, r.format, r.params);
                  return (
                    <li key={r.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                      <div className="flex min-w-0 items-center gap-2">
                        <Icon name={r.format === "excel" ? "Download" : "Printer"} className="size-4 shrink-0 text-muted-foreground" />
                        <span className="truncate font-medium">{r.label}</span>
                        <Badge variant="secondary" className="shrink-0 uppercase">{r.format}</Badge>
                        <span className="shrink-0 text-xs text-muted-foreground">{dt(r.createdAt)}</span>
                      </div>
                      {dl ? (
                        <a
                          href={dl.href}
                          {...(dl.blank ? { target: "_blank", rel: "noopener" } : { download: true })}
                          className="flex shrink-0 items-center gap-1 rounded-lg bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
                        >
                          <Icon name="Download" className="size-3.5" />إعادة التحميل
                        </a>
                      ) : (
                        <span className="shrink-0 text-xs text-muted-foreground">غير متاح</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    );
  });
}
