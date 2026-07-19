"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icon";

export type BrowserReport = {
  key: string;
  label: string;
  desc: string;
  icon: string;
  href: string;
  category: string;
  /** Excel export URL (year-to-date defaults) when the report supports it. */
  excel?: string;
};

/**
 * A searchable, category-filtered report launcher — replaces a long scroll of
 * cards. Type to filter across all reports; click a category to narrow. Each
 * row opens the report and (where available) downloads Excel directly.
 */
export function ReportBrowser({ reports }: { reports: BrowserReport[] }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("الكل");

  const categories = useMemo(() => ["الكل", ...Array.from(new Set(reports.map((r) => r.category)))], [reports]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return reports.filter(
      (r) =>
        (cat === "الكل" || r.category === cat) &&
        (!needle || r.label.toLowerCase().includes(needle) || r.desc.toLowerCase().includes(needle)),
    );
  }, [reports, q, cat]);

  // Group the filtered set by category (preserving the source order).
  const groups = useMemo(() => {
    const order = Array.from(new Set(reports.map((r) => r.category)));
    return order
      .map((c) => ({ category: c, items: filtered.filter((r) => r.category === c) }))
      .filter((g) => g.items.length > 0);
  }, [reports, filtered]);

  return (
    <div className="space-y-4">
      {/* Search + category filter */}
      <div className="space-y-3">
        <div className="relative">
          <Icon name="Search" className="pointer-events-none absolute end-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="ابحث عن تقرير…"
            className="h-11 w-full rounded-xl border bg-card pe-10 ps-4 text-sm shadow-sm outline-none focus:border-primary"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {categories.map((c) => {
            const active = c === cat;
            return (
              <button
                key={c}
                type="button"
                onClick={() => setCat(c)}
                className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                  active ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:border-primary hover:bg-accent"
                }`}
              >
                {c}
              </button>
            );
          })}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">لا يوجد تقرير مطابق لبحثك.</div>
      ) : (
        <div className="space-y-6">
          {groups.map((g) => (
            <div key={g.category}>
              <h3 className="mb-2 text-sm font-semibold text-muted-foreground">{g.category}</h3>
              <div className="grid gap-2 lg:grid-cols-2">
                {g.items.map((r) => (
                  <div
                    key={r.key}
                    className="group flex items-center gap-3 rounded-xl border bg-card px-3 py-2.5 transition-colors hover:border-primary/60"
                  >
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Icon name={r.icon} className="size-4" />
                    </div>
                    <Link href={r.href} className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{r.label}</div>
                      <div className="truncate text-xs text-muted-foreground">{r.desc}</div>
                    </Link>
                    <div className="flex shrink-0 items-center gap-1">
                      {r.excel && (
                        <a
                          href={r.excel}
                          title="تحميل Excel"
                          className="flex size-8 items-center justify-center rounded-lg border text-muted-foreground transition-colors hover:border-emerald-500/50 hover:bg-emerald-500/10 hover:text-emerald-600"
                        >
                          <Icon name="Download" className="size-4" />
                        </a>
                      )}
                      <Link
                        href={r.href}
                        className="flex h-8 items-center gap-1 rounded-lg bg-primary/10 px-3 text-xs font-medium text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
                      >
                        عرض
                        <Icon name="ArrowLeft" className="size-3.5" />
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
