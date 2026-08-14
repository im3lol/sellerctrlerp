"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { recordReportDownloadAction } from "@/app/actions/erp/report-downloads";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Icon } from "@/components/icon";
import { REPORT_MODULES, reportQuery, type CatalogReport } from "@/lib/erp/report-catalog";

const todayISO = () => new Date().toISOString().slice(0, 10);
const yearStartISO = () => `${new Date().getFullYear()}-01-01`;

/** One-page report generator: module → report → period → format → export. */
// Module scope, not inside the component: declaring it inline gave React a new component
// type every render, remounting each step header. It closes over nothing, so this is a
// straight move.
const Step = ({ n, title, done }: { n: number; title: string; done?: boolean }) => (
  <div className="mb-3 flex items-center gap-2">
    <span className={`grid size-6 place-items-center rounded-full text-xs font-bold ${done ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>{n}</span>
    <span className="text-sm font-semibold">{title}</span>
  </div>
);

export function ReportGenerator() {
  const [moduleKey, setModuleKey] = useState<string | null>(null);
  const [report, setReport] = useState<CatalogReport | null>(null);
  const [from, setFrom] = useState(yearStartISO());
  const [to, setTo] = useState(todayISO());
  const [format, setFormat] = useState<"pdf" | "excel">("pdf");
  const router = useRouter();

  const activeModule = REPORT_MODULES.find((m) => m.key === moduleKey) ?? null;

  const pickModule = (k: string) => { setModuleKey(k); setReport(null); };
  const pickReport = (r: CatalogReport) => { setReport(r); if (!r.excel) setFormat("pdf"); };

  const run = () => {
    if (!report) return;
    const qs = reportQuery(report.dates, from, to);
    const fmt = format === "excel" && report.excel ? "excel" : "pdf";
    // Log the download so it appears in the re-download list, then refresh it.
    recordReportDownloadAction({ reportKey: report.key, label: report.label, format: fmt, params: qs })
      .then(() => router.refresh())
      .catch(() => {});
    if (fmt === "excel" && report.excel) {
      window.location.href = report.excel + (qs ? `?${qs}` : "");
    } else {
      const sep = qs ? `${qs}&` : "";
      window.open(`${report.view}?${sep}print=1`, "_blank");
    }
  };

  return (
    <Card>
      <CardContent className="space-y-8 pt-6">
        {/* 1 — module */}
        <div>
          <Step n={1} title="اختر الموديول" done={!!moduleKey} />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {REPORT_MODULES.map((m) => {
              const active = m.key === moduleKey;
              return (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => pickModule(m.key)}
                  className={`flex flex-col items-center gap-2 rounded-xl border p-4 text-center transition-colors ${active ? "border-primary bg-primary/5" : "bg-card hover:border-primary/60 hover:bg-accent"}`}
                >
                  <span className={`grid size-10 place-items-center rounded-lg ${active ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary"}`}>
                    <Icon name={m.icon} className="size-5" />
                  </span>
                  <span className="text-sm font-medium">{m.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* 2 — report */}
        {activeModule && (
          <div>
            <Step n={2} title="اختر التقرير" done={!!report} />
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {activeModule.reports.map((r) => {
                const active = r.key === report?.key;
                return (
                  <button
                    key={r.key}
                    type="button"
                    onClick={() => pickReport(r)}
                    className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2.5 text-start text-sm transition-colors ${active ? "border-primary bg-primary/5 font-medium" : "bg-card hover:border-primary/60 hover:bg-accent"}`}
                  >
                    <span>{r.label}</span>
                    {active && <Icon name="Check" className="size-4 text-primary" />}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* 3 — period */}
        {report && report.dates !== "none" && (
          <div>
            <Step n={3} title="حدّد الفترة" done />
            <div className="flex flex-wrap items-end gap-3">
              {report.dates === "range" && (
                <div className="space-y-1">
                  <Label htmlFor="from">من تاريخ</Label>
                  <input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="flex h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm outline-none focus:border-primary" />
                </div>
              )}
              <div className="space-y-1">
                <Label htmlFor="to">{report.dates === "asOf" ? "كما في تاريخ" : "إلى تاريخ"}</Label>
                <input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="flex h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm outline-none focus:border-primary" />
              </div>
            </div>
          </div>
        )}

        {/* 4 — format */}
        {report && (
          <div>
            <Step n={report.dates === "none" ? 3 : 4} title="اختر الصيغة" done />
            <div className="flex flex-wrap gap-3">
              {([
                { v: "pdf", label: "PDF (طباعة)", icon: "Printer", enabled: true },
                { v: "excel", label: "Excel", icon: "Download", enabled: !!report.excel },
              ] as const).map((f) => {
                const active = format === f.v;
                return (
                  <button
                    key={f.v}
                    type="button"
                    disabled={!f.enabled}
                    onClick={() => setFormat(f.v)}
                    className={`flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${active ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:border-primary/60"}`}
                  >
                    <Icon name={f.icon} className="size-4" />{f.label}
                  </button>
                );
              })}
              {!report.excel && <span className="self-center text-xs text-muted-foreground">Excel غير متاح لهذا التقرير بعد</span>}
            </div>
          </div>
        )}

        {/* run */}
        {report && (
          <div className="border-t pt-5">
            <Button onClick={run} size="lg" className="gap-2">
              <Icon name={format === "excel" ? "Download" : "FileText"} className="size-4" />
              استخراج «{report.label}» {format === "excel" ? "Excel" : "PDF"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
