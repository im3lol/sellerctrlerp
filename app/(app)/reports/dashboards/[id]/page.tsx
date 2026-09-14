import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq, inArray, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { dashboards, savedReports } from "@/db/schema";
import { loadErpPage } from "@/lib/erp/org";
import { requireUser } from "@/lib/session";
import { EXPORT_DATASETS } from "@/lib/erp/export-datasets";
import { runReport, type Cell, type ChartKind, type ReportResult } from "@/lib/erp/report-builder";
import { listSavedReportsAction } from "@/app/actions/erp/report-builder";
import { ErpPageHeader } from "@/components/erp/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";
import { ReportChart } from "@/components/erp/report-chart";
import { DashboardEditor } from "@/components/erp/dashboard-editor";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const fmt = (v: Cell) =>
  typeof v === "number" ? v.toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 2 }) : (v ?? "");
const int = (n: number) => n.toLocaleString("ar-EG-u-nu-latn");
const PREVIEW_ROWS = 8;
// A chart draws at most a year of points; the client never needs more rows than that.
const CHART_ROWS = 366;

type Tile = {
  reportId: string; title: string; wide: boolean;
  source?: string; chart?: ChartKind | null; result?: ReportResult; note?: string;
};

export default async function DashboardPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ edit?: string }>;
}) {
  const { id } = await params;
  const { edit } = await searchParams;

  return loadErpPage("reports.view", async ({ orgId, can }) => {
    const user = await requireUser();
    const [board] = await db.select().from(dashboards)
      .where(and(
        eq(dashboards.id, id), eq(dashboards.organizationId, orgId),
        or(eq(dashboards.isShared, true), eq(dashboards.createdBy, user.id)),
      )).limit(1);
    if (!board) notFound();
    const mine = !board.createdBy || board.createdBy === user.id;

    const ids = board.widgets.map((w) => w.reportId);
    const reports = ids.length === 0 ? [] : await db.select().from(savedReports)
      .where(and(
        eq(savedReports.organizationId, orgId), inArray(savedReports.id, ids),
        or(eq(savedReports.isShared, true), eq(savedReports.createdBy, user.id)),
      ));

    // Each report runs through the builder's engine on its dataset's own read-only fetcher,
    // gated by the viewer's permission for that dataset. One fetch per dataset, in turn —
    // they share this request's transaction.
    const fetched = new Map<string, Cell[][]>();
    const tiles: Tile[] = [];
    for (const w of board.widgets) {
      const r = reports.find((x) => x.id === w.reportId);
      const ds = r ? EXPORT_DATASETS[r.dataset] : undefined;
      if (!r || !ds) {
        tiles.push({ reportId: w.reportId, title: "تقرير مش متاح", wide: !!w.wide, note: "اتمسح، أو صاحبه ماشاركهوش مع الفريق." });
        continue;
      }
      if (!can(ds.module)) {
        tiles.push({ reportId: r.id, title: r.nameAr, wide: !!w.wide, note: "البيانات دي مش ضمن صلاحياتك." });
        continue;
      }
      let rows = fetched.get(r.dataset);
      if (!rows) {
        rows = (await ds.fetch(orgId)) as Cell[][];
        fetched.set(r.dataset, rows);
      }
      tiles.push({
        reportId: r.id, title: r.nameAr, wide: !!w.wide, source: ds.title,
        chart: r.spec.chart, result: runReport(ds.headers, rows, r.spec),
      });
    }

    const editing = mine && edit === "1";
    const options = editing
      ? ((await listSavedReportsAction()).rows ?? [])
          .filter((r) => can(EXPORT_DATASETS[r.dataset].module))
          .map((r) => ({ id: r.id, nameAr: r.nameAr, datasetTitle: r.datasetTitle, isShared: r.isShared }))
      : [];

    return (
      <div className="space-y-6">
        <ErpPageHeader
          icon="LayoutDashboard"
          title={board.nameAr}
          subtitle={board.isShared ? "لوحة مشتركة مع الفريق" : "لوحة خاصة بيك"}
          backHref="/reports/dashboards"
          action={mine && !editing ? (
            <Button asChild variant="outline">
              <Link href={`/reports/dashboards/${board.id}?edit=1`}><Icon name="Pencil" className="size-4" />تعديل</Link>
            </Button>
          ) : undefined}
        />

        {editing && (
          <DashboardEditor
            dashboard={{ id: board.id, nameAr: board.nameAr, isShared: board.isShared, widgets: board.widgets }}
            reports={options}
          />
        )}

        {tiles.length === 0 ? (
          !editing && (
            <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
              اللوحة فاضية.{mine && " دوس «تعديل» وضيف تقارير محفوظة."}
            </div>
          )
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {tiles.map((t, i) => (
              <Card key={`${t.reportId}-${i}`} className={cn(t.wide && "lg:col-span-2")}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <CardTitle className="truncate text-base">{t.title}</CardTitle>
                      {t.result && (
                        <CardDescription>
                          {t.source} · {int(t.result.matched)} {t.result.grouped ? "مجموعة" : "صف"}
                        </CardDescription>
                      )}
                    </div>
                    {t.result && (
                      <Link href={`/reports/builder?r=${t.reportId}`} title="افتحه في باني التقارير"
                        className="text-muted-foreground hover:text-primary">
                        <Icon name="ExternalLink" className="size-4" />
                      </Link>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {!t.result ? (
                    <p className="text-sm text-muted-foreground">{t.note}</p>
                  ) : (
                    <>
                      {t.result.totals.length > 0 && (
                        <div className="flex flex-wrap gap-4">
                          {t.result.totals.map((x, k) => (
                            <div key={k}>
                              <div className="text-xs text-muted-foreground">{x.label}</div>
                              <div className="text-lg font-bold tabular-nums">{fmt(x.value)}</div>
                            </div>
                          ))}
                        </div>
                      )}
                      {t.result.rows.length === 0 ? (
                        <p className="text-sm text-muted-foreground">مفيش صفوف بالشروط دي.</p>
                      ) : t.chart && t.result.grouped ? (
                        <ReportChart result={{ ...t.result, rows: t.result.rows.slice(0, CHART_ROWS) }} kind={t.chart} id={`w${i}`} />
                      ) : (
                        <div className="overflow-x-auto rounded-xl border">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                {t.result.headers.map((h, k) => <TableHead key={k} className="whitespace-nowrap text-start">{h}</TableHead>)}
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {t.result.rows.slice(0, PREVIEW_ROWS).map((row, k) => (
                                <TableRow key={k}>
                                  {row.map((c, j) => (
                                    <TableCell key={j} className={typeof c === "number" ? "tabular-nums" : ""}>{fmt(c)}</TableCell>
                                  ))}
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      )}
                      {!t.chart && t.result.rows.length > PREVIEW_ROWS && (
                        <p className="text-xs text-muted-foreground">
                          و{int(t.result.rows.length - PREVIEW_ROWS)} كمان — <Link href={`/reports/builder?r=${t.reportId}`} className="text-primary underline">شوف الكل</Link>
                        </p>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    );
  });
}
