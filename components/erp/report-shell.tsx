import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Icon } from "@/components/icon";
import { ErpPageHeader } from "@/components/erp/page-header";
import { ReportToolbar } from "@/components/erp/report-toolbar";
import { ReportSwitcher } from "@/components/erp/report-switcher";
import { REPORT_MODULES } from "@/lib/erp/report-catalog";
import { cn } from "@/lib/utils";

/**
 * One shape for every report: filters, the headline numbers, the chart, the table.
 *
 * Twenty-three report pages each invented their own. Most wrapped two date inputs in a
 * card titled "الفترة" — a heading, a description and a card border spent on two fields
 * — then dropped a flat table underneath with the totals hidden in its last row. The
 * number you came for was the hardest thing on the page to find.
 *
 * The order here is the order a reader wants: what am I looking at (header), what can I
 * change (filters), what is the answer (KPIs), how did it move (chart), show your work
 * (table).
 */

export type ReportKpi =
  | { op: "−" | "+" | "=" | "×" | "÷" }
  | { label: string; value: string; tone?: "profit" | "loss" | "muted"; hint?: string };

const TONE: Record<string, string> = {
  profit: "text-emerald-600",
  loss: "text-destructive",
  muted: "text-muted-foreground",
};

/** A labelled field inside the filter grid. Native inputs — the browser's are better. */
export function ReportField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

export function ReportShell({
  /** Catalogue key — the Excel and print links come from it, so no page hand-writes them. */
  reportKey,
  icon,
  title,
  subtitle,
  /** Marks the current entry in the switcher, and defaults to the catalogue's view path. */
  current,
  query,
  permissions,
  /** ReportField elements. Laid out in a grid; the submit button is added here. */
  filters,
  /** Hidden inputs the filter form must resubmit (a tab, a mode) — inside the form. */
  filterHidden,
  kpis,
  chart,
  chartTitle,
  children,
}: {
  reportKey: string;
  icon: string;
  title: string;
  subtitle?: string;
  current?: string;
  query?: string;
  permissions: string[];
  filters?: ReactNode;
  filterHidden?: ReactNode;
  kpis?: ReportKpi[];
  chart?: ReactNode;
  chartTitle?: string;
  children: ReactNode;
}) {
  const entry = REPORT_MODULES.flatMap((m) => m.reports).find((r) => r.key === reportKey);
  const view = current ?? entry?.view ?? "";
  // Export and print must show what the screen shows, so both carry the live filters.
  const qs = query ? `?${query}` : "";

  return (
    <div className="space-y-5">
      <ErpPageHeader
        icon={icon}
        title={title}
        subtitle={subtitle}
        action={<ReportToolbar excel={entry?.excel ? `${entry.excel}${qs}` : undefined} printHref={entry?.print ? `${entry.print}${qs}` : undefined} />}
      />

      <div className="no-print">
        <ReportSwitcher current={view} permissions={permissions} />
      </div>

      {filters && (
        <Card className="no-print">
          <CardContent className="pt-6">
            <form className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
              {filterHidden}
              {filters}
              <Button type="submit" className="h-9">
                <Icon name="Search" className="size-4" />
                عرض
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {kpis && kpis.length > 0 && <ReportKpis items={kpis} />}

      {chart && (
        <Card className="no-print">
          {chartTitle && <CardHeader className="pb-2"><CardTitle className="text-base">{chartTitle}</CardTitle></CardHeader>}
          <CardContent className={chartTitle ? undefined : "pt-6"}>{chart}</CardContent>
        </Card>
      )}

      {children}
    </div>
  );
}

/**
 * The headline numbers, with the arithmetic between them shown rather than implied.
 * "Income − Expense = Net" tells a reader where the last number came from, which a row
 * of three unrelated cards never does.
 */
export function ReportKpis({ items }: { items: ReportKpi[] }) {
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center justify-center gap-x-4 gap-y-6 py-6 sm:justify-between sm:px-8">
        {items.map((k, i) =>
          "op" in k ? (
            <span key={i} className="flex size-8 shrink-0 items-center justify-center rounded-lg border text-lg text-muted-foreground">
              {k.op}
            </span>
          ) : (
            <div key={i} className="min-w-0 flex-1 text-center">
              <div className="truncate text-sm text-muted-foreground">{k.label}</div>
              <div className={cn("mt-1 text-2xl font-bold tabular-nums sm:text-3xl", k.tone && TONE[k.tone])}>{k.value}</div>
              {k.hint && <div className="mt-0.5 truncate text-xs text-muted-foreground">{k.hint}</div>}
            </div>
          ),
        )}
      </CardContent>
    </Card>
  );
}
