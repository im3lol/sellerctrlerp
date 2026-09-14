"use client";

import { BarChart } from "@/components/charts/bar-chart";
import { GroupedBarChart } from "@/components/charts/grouped-bar-chart";
import { TrendChart } from "@/components/charts/trend-chart";
import { StatusDonut } from "@/components/charts/status-donut";
import { chartData, topWithOther, type ChartKind, type ReportResult } from "@/lib/erp/report-builder";

// The validated categorical order (dataviz reference palette), always from slot 1. A pivot
// has at most PIVOT_MAX = 8 columns and a donut folds past 8, so no hue is ever reused.
const SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"];

/** Draws a grouped report: one series (bars, trend, donut) or, pivoted, one bar per column. */
export function ReportChart({ result, kind, height = 260, id }: { result: ReportResult; kind: ChartKind; height?: number; id?: string }) {
  const d = chartData(result, kind === "trend" ? 366 : 24);
  if (!d) return <p className="py-8 text-center text-sm text-muted-foreground">الرسم محتاج «تجميع حسب».</p>;

  if (d.kind === "multi") {
    return <GroupedBarChart data={d.points} series={d.series.map((s, i) => ({ ...s, color: SERIES[i] }))} height={height} />;
  }
  if (kind === "trend") return <TrendChart data={d.points} valueLabel={d.valueLabel} height={height} id={id} />;
  if (kind === "donut") {
    return (
      <StatusDonut unit={d.valueLabel}
        data={topWithOther(d.points, SERIES.length).map((p, i) => ({ name: p.label, value: p.value, color: SERIES[i] }))} />
    );
  }
  return <BarChart data={d.points} valueLabel={d.valueLabel} height={height} />;
}
