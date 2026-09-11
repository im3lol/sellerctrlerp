"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icon";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { REPORT_MODULES } from "@/lib/erp/report-catalog";
import { cn } from "@/lib/utils";

/**
 * Jump from any report to any other report.
 *
 * The financial statements had a five-tab strip; everything else had nothing, so the
 * only way from the stock ledger to the customer ranking was back through the sidebar.
 * The catalogue already knows all thirty-five, grouped by module — it was only ever
 * read by the export generator.
 *
 * Five of them have no sidebar row at all and were reachable by URL only:
 * /reports/ratios, /reports/cost-centers, /reports/fx-revaluation, /sales/aging and
 * /purchases/aging.
 */

/** Catalogue modules aren't ERP permissions; this is the mapping the pages already use. */
const MODULE_PERMISSION: Record<string, string> = {
  accounting: "accounting.view",
  sales: "sales.view",
  purchases: "purchases.view",
  inventory: "inventory.view",
  hr: "hr.view",
  operations: "accounting.view",
};

export function ReportSwitcher({
  /** Current report's view path, marked in the list. */
  current,
  permissions,
}: {
  current: string;
  permissions: string[];
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");

  const groups = useMemo(() => {
    const perms = new Set(permissions);
    const needle = q.trim().toLowerCase();
    return REPORT_MODULES
      .filter((m) => perms.has(MODULE_PERMISSION[m.key] ?? ""))
      .map((m) => {
        // Several catalogue rows share one page (two exports off /projects, say). As a
        // way to NAVIGATE they'd be the same row twice, so keep the first of each.
        const seen = new Set<string>();
        const reports = m.reports.filter((r) => {
          if (seen.has(r.view)) return false;
          seen.add(r.view);
          return !needle || r.label.toLowerCase().includes(needle) || m.label.toLowerCase().includes(needle);
        });
        return { ...m, reports };
      })
      .filter((m) => m.reports.length > 0);
  }, [permissions, q]);

  const currentLabel = REPORT_MODULES.flatMap((m) => m.reports).find((r) => r.view === current)?.label;
  const total = groups.reduce((s, g) => s + g.reports.length, 0);

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQ(""); }}>
      <DialogTrigger className="inline-flex items-center gap-2 rounded-lg border bg-background px-3 py-1.5 text-sm transition-colors hover:bg-accent">
        <Icon name="ChartColumn" className="size-4 text-muted-foreground" />
        <span className="font-medium">{currentLabel ?? "التقارير"}</span>
        <Icon name="ChevronDown" className="size-4 text-muted-foreground" />
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogTitle>كل التقارير</DialogTitle>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحث عن تقرير…" autoFocus />
        {total === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">مفيش تقرير بالاسم ده.</p>
        ) : (
          <div className="space-y-4">
            {groups.map((m) => (
              <div key={m.key} className="space-y-1">
                <div className="flex items-center gap-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <Icon name={m.icon} className="size-3.5" />
                  {m.label}
                </div>
                <div className="grid gap-1 sm:grid-cols-2">
                  {m.reports.map((r) => (
                    <Link
                      key={r.key}
                      href={r.view}
                      onClick={() => setOpen(false)}
                      className={cn(
                        "flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors",
                        r.view === current ? "bg-primary text-primary-foreground" : "hover:bg-accent",
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate">{r.label}</span>
                      {r.view === current && <Icon name="Check" className="size-4 shrink-0" />}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
