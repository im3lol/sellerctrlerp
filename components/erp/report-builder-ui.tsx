"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import {
  runReportAction, saveReportAction, deleteReportAction,
  type RunReportResult, type SavedReportRow,
} from "@/app/actions/erp/report-builder";
import {
  FILTER_LABEL, AGGREGATE_LABEL, EMPTY_SPEC,
  type Aggregate, type Filter, type FilterOp, type ReportSpec,
} from "@/lib/erp/report-builder";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/icon";
import { confirm } from "@/components/erp/confirm";
import { selectCls } from "@/lib/utils";

export type DatasetOption = { key: string; title: string; headers: string[] };

const fmt = (v: unknown) =>
  typeof v === "number" ? v.toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 2 }) : (v ?? "") as string;

const NO_VALUE: FilterOp[] = ["empty", "notEmpty"];

/**
 * Pick a dataset, choose what to show, filter it, group it, total it. Everything runs
 * against the same read-only fetchers the Excel export uses — the builder opens no door
 * that was not already open.
 */
export function ReportBuilderUI({ datasets, saved }: { datasets: DatasetOption[]; saved: SavedReportRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [dataset, setDataset] = useState(datasets[0]?.key ?? "");
  const [spec, setSpec] = useState<ReportSpec>({ ...EMPTY_SPEC });
  const [result, setResult] = useState<RunReportResult | null>(null);
  const [savingAs, setSavingAs] = useState<{ id?: string; nameAr: string; isShared: boolean } | null>(null);

  const ds = datasets.find((d) => d.key === dataset);
  const headers = ds?.headers ?? [];

  const run = (theDataset = dataset, theSpec = spec) =>
    start(async () => {
      const r = await runReportAction(theDataset, theSpec);
      if (!r.ok || !r.result) { toast.error(r.error ?? "تعذّر تشغيل التقرير"); return; }
      setResult(r.result);
    });

  // Switching dataset invalidates every column index in the spec, so it starts clean.
  const pickDataset = (key: string) => {
    setDataset(key);
    setSpec({ ...EMPTY_SPEC });
    setResult(null);
  };

  useEffect(() => { if (dataset) run(dataset, { ...EMPTY_SPEC }); /* first load */ }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const setFilter = (i: number, patch: Partial<Filter>) =>
    setSpec((s) => ({ ...s, filters: s.filters.map((f, k) => (k === i ? { ...f, ...patch } : f)) }));

  const toggleColumn = (i: number) =>
    setSpec((s) => ({
      ...s,
      columns: s.columns.includes(i) ? s.columns.filter((c) => c !== i) : [...s.columns, i],
    }));

  const load = (r: SavedReportRow) => {
    setDataset(r.dataset);
    setSpec(r.spec);
    setSavingAs({ id: r.mine ? r.id : undefined, nameAr: r.nameAr, isShared: r.isShared });
    run(r.dataset, r.spec);
  };

  return (
    <div className="space-y-6">
      {saved.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>تقارير محفوظة</CardTitle>
            <CardDescription>المحفوظ هو السؤال مش الإجابة — الأرقام بتتقرا من جديد كل مرة.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {saved.map((r) => (
                <div key={r.id} className="flex items-center gap-1 rounded-lg border px-3 py-2">
                  <button className="text-sm font-medium hover:underline" onClick={() => load(r)}>
                    {r.nameAr}
                  </button>
                  <span className="text-xs text-muted-foreground">({r.datasetTitle})</span>
                  {r.isShared && <Badge variant="outline" className="text-xs">مشترك</Badge>}
                  {r.mine && (
                    <Button size="icon" variant="ghost" aria-label="مسح" onClick={() => void (async () => {
                      const go = await confirm({
                        danger: true, title: `تمسح «${r.nameAr}»؟`,
                        description: "التقرير بس اللي هيتمسح — البيانات نفسها مش بتتأثر.",
                        confirmText: "امسح", cancelText: "رجوع",
                      });
                      if (!go) return;
                      start(async () => {
                        const res = await deleteReportAction(r.id);
                        if (res.ok) { toast.success("اتمسح"); router.refresh(); }
                        else toast.error(res.error ?? "تعذّر المسح");
                      });
                    })()}>
                      <Icon name="X" className="size-3 text-destructive" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>ابنِ تقرير</CardTitle>
          <CardDescription>
            اختار البيانات، حدّد الأعمدة، حطّ الشروط، وجمّع. كل حاجة بتقرأ بس — مفيش أي كتابة.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-2">
              <Label>البيانات</Label>
              <select className={`${selectCls} w-56`} value={dataset} onChange={(e) => pickDataset(e.target.value)}>
                {datasets.map((d) => <option key={d.key} value={d.key}>{d.title}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <Label>تجميع حسب</Label>
              <select className={`${selectCls} w-48`} value={spec.groupBy ?? ""}
                onChange={(e) => setSpec((s) => ({ ...s, groupBy: e.target.value === "" ? null : Number(e.target.value) }))}>
                <option value="">بدون تجميع</option>
                {headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <Label>أقصى عدد صفوف</Label>
              <Input type="number" step="1" min="0" className="w-32 tabular-nums" placeholder="الكل"
                value={spec.limit ?? ""}
                onChange={(e) => setSpec((s) => ({ ...s, limit: e.target.value === "" ? undefined : Number(e.target.value) }))} />
            </div>
            <Button onClick={() => run()} disabled={pending || !dataset}>
              <Icon name="Play" className="size-4" />شغّل
            </Button>
            <Button variant="outline" onClick={() => { setSpec({ ...EMPTY_SPEC }); setSavingAs(null); run(dataset, { ...EMPTY_SPEC }); }}>
              ابدأ من جديد
            </Button>
          </div>

          {spec.groupBy == null && (
            <div className="space-y-2">
              <Label>الأعمدة {spec.columns.length === 0 && <span className="text-xs text-muted-foreground">(مفيش اختيار = كل الأعمدة)</span>}</Label>
              <div className="flex flex-wrap gap-2">
                {headers.map((h, i) => (
                  <Button key={i} size="sm" variant={spec.columns.includes(i) ? "default" : "outline"}
                    onClick={() => toggleColumn(i)}>
                    {h}
                  </Button>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label>الشروط</Label>
              <Button size="sm" variant="outline" disabled={spec.filters.length >= 10}
                onClick={() => setSpec((s) => ({ ...s, filters: [...s.filters, { column: 0, op: "contains", value: "" }] }))}>
                <Icon name="Plus" className="size-4" />شرط
              </Button>
            </div>
            {spec.filters.length === 0 ? (
              <p className="text-xs text-muted-foreground">مفيش شروط — التقرير هيرجّع كل الصفوف.</p>
            ) : spec.filters.map((f, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <select className={`${selectCls} w-44`} value={f.column}
                  onChange={(e) => setFilter(i, { column: Number(e.target.value) })}>
                  {headers.map((h, k) => <option key={k} value={k}>{h}</option>)}
                </select>
                <select className={`${selectCls} w-40`} value={f.op}
                  onChange={(e) => setFilter(i, { op: e.target.value as FilterOp })}>
                  {(Object.keys(FILTER_LABEL) as FilterOp[]).map((op) => (
                    <option key={op} value={op}>{FILTER_LABEL[op]}</option>
                  ))}
                </select>
                {!NO_VALUE.includes(f.op) && (
                  <Input className="w-40" value={f.value ?? ""} placeholder="القيمة"
                    onChange={(e) => setFilter(i, { value: e.target.value })} />
                )}
                {f.op === "between" && (
                  <Input className="w-40" value={f.value2 ?? ""} placeholder="إلى"
                    onChange={(e) => setFilter(i, { value2: e.target.value })} />
                )}
                <Button size="icon" variant="ghost" aria-label="شيل الشرط"
                  onClick={() => setSpec((s) => ({ ...s, filters: s.filters.filter((_, k) => k !== i) }))}>
                  <Icon name="X" className="size-4 text-destructive" />
                </Button>
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label>الإجماليات</Label>
              <Button size="sm" variant="outline" disabled={spec.aggregates.length >= 8}
                onClick={() => setSpec((s) => ({ ...s, aggregates: [...s.aggregates, { column: 0, agg: "sum" }] }))}>
                <Icon name="Plus" className="size-4" />إجمالي
              </Button>
            </div>
            {spec.aggregates.map((a, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <select className={`${selectCls} w-40`} value={a.agg}
                  onChange={(e) => setSpec((s) => ({ ...s, aggregates: s.aggregates.map((x, k) => (k === i ? { ...x, agg: e.target.value as Aggregate } : x)) }))}>
                  {(Object.keys(AGGREGATE_LABEL) as Aggregate[]).map((k) => (
                    <option key={k} value={k}>{AGGREGATE_LABEL[k]}</option>
                  ))}
                </select>
                <select className={`${selectCls} w-44`} value={a.column}
                  onChange={(e) => setSpec((s) => ({ ...s, aggregates: s.aggregates.map((x, k) => (k === i ? { ...x, column: Number(e.target.value) } : x)) }))}>
                  {headers.map((h, k) => <option key={k} value={k}>{h}</option>)}
                </select>
                <Button size="icon" variant="ghost" aria-label="شيل"
                  onClick={() => setSpec((s) => ({ ...s, aggregates: s.aggregates.filter((_, k) => k !== i) }))}>
                  <Icon name="X" className="size-4 text-destructive" />
                </Button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardHeader>
            <div className="flex w-full flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle>{result.datasetTitle}</CardTitle>
                <CardDescription>
                  {result.matched} {result.grouped ? "مجموعة" : "صف"}
                  {result.rows.length < result.matched && ` · معروض ${result.rows.length}`}
                </CardDescription>
              </div>
              <Button size="sm" variant="outline"
                onClick={() => setSavingAs((v) => v ?? { nameAr: "", isShared: false })}>
                <Icon name="Save" className="size-4" />احفظ التقرير
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {savingAs && (
              <div className="flex flex-wrap items-end gap-2 rounded-lg border p-3">
                <div className="space-y-2"><Label>اسم التقرير</Label>
                  <Input className="w-64" value={savingAs.nameAr} autoFocus
                    onChange={(e) => setSavingAs((v) => (v ? { ...v, nameAr: e.target.value } : v))} /></div>
                <label className="flex cursor-pointer items-center gap-2 pb-2 text-sm">
                  <input type="checkbox" className="size-4 rounded border-input" checked={savingAs.isShared}
                    onChange={(e) => setSavingAs((v) => (v ? { ...v, isShared: e.target.checked } : v))} />
                  شاركه مع باقي الفريق
                </label>
                <Button disabled={pending || !savingAs.nameAr.trim()}
                  onClick={() => start(async () => {
                    const r = await saveReportAction({
                      id: savingAs.id, nameAr: savingAs.nameAr, dataset, spec, isShared: savingAs.isShared,
                    });
                    if (r.ok) { toast.success("اتحفظ"); setSavingAs(null); router.refresh(); }
                    else toast.error(r.error ?? "تعذّر الحفظ");
                  })}>
                  <Icon name="Check" className="size-4" />احفظ
                </Button>
                <Button variant="ghost" onClick={() => setSavingAs(null)}>رجوع</Button>
              </div>
            )}

            {result.totals.length > 0 && (
              <div className="flex flex-wrap gap-4 rounded-lg border p-3">
                {result.totals.map((t, i) => (
                  <div key={i}>
                    <div className="text-xs text-muted-foreground">{t.label}</div>
                    <div className="text-lg font-bold tabular-nums">{fmt(t.value)}</div>
                  </div>
                ))}
              </div>
            )}

            {result.rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">مفيش صفوف بالشروط دي.</p>
            ) : (
              <div className="overflow-x-auto rounded-xl border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {result.headers.map((h, i) => (
                        <TableHead key={i} className="cursor-pointer whitespace-nowrap text-start"
                          onClick={() => {
                            const next: ReportSpec = {
                              ...spec,
                              sort: spec.sort?.column === i && spec.sort.dir === "asc"
                                ? { column: i, dir: "desc" }
                                : { column: i, dir: "asc" },
                            };
                            setSpec(next);
                            run(dataset, next);
                          }}>
                          {h}
                          {spec.sort?.column === i && (spec.sort.dir === "asc" ? " ↑" : " ↓")}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.rows.map((row, i) => (
                      <TableRow key={i}>
                        {row.map((cell, k) => (
                          <TableCell key={k} className={typeof cell === "number" ? "tabular-nums" : ""}>
                            {fmt(cell)}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
