import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { REPORT_MODULES } from "@/lib/erp/report-catalog";

/**
 * The catalogue is now load-bearing: it is where every report page gets its Excel link,
 * its print link, and its place in the switcher. It used to feed one export screen, so
 * a wrong path there was invisible.
 *
 * It was wrong. Five print buttons pointed at `/reports/<x>/print` when every print view
 * lives under `/erp/...` — the (print) route group kept the prefix the app dropped — so
 * trial balance, income statement, balance sheet, cash flow and VAT all opened a 404.
 * Nobody noticed because nothing checked.
 */

const reports = REPORT_MODULES.flatMap((m) => m.reports.map((r) => ({ ...r, module: m.label })));

/** `/erp/a/b/print` is served by `app/(print)/erp/a/b/print/page.tsx`. */
const printFile = (href: string) => `app/(print)${href}/page.tsx`;
/** `/sales/orders` is served by `app/(app)/sales/orders/page.tsx`. */
const viewFile = (href: string) => `app/(app)${href}/page.tsx`;

describe("REPORT_MODULES", () => {
  it("every view is a page that exists", () => {
    const dead = reports.filter((r) => !existsSync(viewFile(r.view))).map((r) => `${r.module} › ${r.label} → ${r.view}`);
    expect(dead).toEqual([]);
  });

  it("every print view is a page that exists", () => {
    const dead = reports
      .filter((r) => r.print && !existsSync(printFile(r.print)))
      .map((r) => `${r.module} › ${r.label} → ${r.print}`);
    expect(dead).toEqual([]);
  });

  it("print views live under /erp — the (print) route group kept the prefix", () => {
    const wrong = reports.filter((r) => r.print && !r.print.startsWith("/erp/")).map((r) => `${r.label} → ${r.print}`);
    expect(wrong).toEqual([]);
  });

  it("keys are unique — the shell looks a report up by key", () => {
    const seen = new Set<string>();
    const dupes = reports.filter((r) => (seen.has(r.key) ? true : (seen.add(r.key), false))).map((r) => r.key);
    expect(dupes).toEqual([]);
  });

  it("every Excel route points at the API", () => {
    const wrong = reports.filter((r) => r.excel && !r.excel.startsWith("/api/")).map((r) => `${r.label} → ${r.excel}`);
    expect(wrong).toEqual([]);
  });
});
