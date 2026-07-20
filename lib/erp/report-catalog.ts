/**
 * Single source of truth for the report generator (one page: module → report →
 * period → format → export). Pure data — safe to import from a client component.
 *
 * `dates`: which date inputs the report takes → the generator builds the query.
 *   "range" = from+to · "asOf" = a single as-of date · "none" = no period.
 * `excel`: export route (year-to-date defaults) when the report has one; PDF is
 * always available (print the view page).
 */
export type ReportDates = "range" | "asOf" | "none";

export type CatalogReport = {
  key: string;
  label: string;
  /** View page path (period + print=1 appended for PDF). */
  view: string;
  /** Excel export path, or null when the report has no export route yet. */
  excel: string | null;
  dates: ReportDates;
};

export type ReportModule = { key: string; label: string; icon: string; reports: CatalogReport[] };

export const REPORT_MODULES: ReportModule[] = [
  {
    key: "accounting",
    label: "المحاسبة والمالية",
    icon: "Calculator",
    reports: [
      { key: "trial-balance", label: "ميزان المراجعة", view: "/reports", excel: "/api/erp/reports/trial-balance/export", dates: "range" },
      { key: "income-statement", label: "قائمة الدخل", view: "/reports/income-statement", excel: "/api/erp/reports/income-statement/export", dates: "range" },
      { key: "balance-sheet", label: "الميزانية العمومية", view: "/reports/balance-sheet", excel: "/api/erp/reports/balance-sheet/export", dates: "asOf" },
      { key: "cash-flow", label: "التدفق النقدي", view: "/reports/cash-flow", excel: "/api/erp/reports/cash-flow/export", dates: "range" },
      { key: "vat", label: "ضريبة القيمة المضافة", view: "/reports/vat", excel: "/api/erp/reports/vat/export", dates: "range" },
      { key: "ratios", label: "المؤشرات المالية", view: "/reports/ratios", excel: "/api/erp/reports/ratios/export", dates: "none" },
      { key: "cost-centers", label: "أرباح مراكز التكلفة", view: "/reports/cost-centers", excel: "/api/erp/reports/cost-centers/export", dates: "range" },
      { key: "fx", label: "إعادة تقييم العملات", view: "/reports/fx-revaluation", excel: "/api/erp/reports/fx-revaluation/export", dates: "none" },
    ],
  },
  {
    key: "sales",
    label: "المبيعات والعملاء",
    icon: "ShoppingCart",
    reports: [
      { key: "sales-profit", label: "ربحية المنتجات", view: "/sales/reports/profitability", excel: "/api/erp/sales/profitability/export", dates: "range" },
      { key: "sales-customers", label: "ترتيب العملاء", view: "/sales/reports/customers", excel: "/api/erp/sales/customers/export", dates: "range" },
      { key: "sales-items", label: "تقرير أصناف المبيعات", view: "/sales/reports/items", excel: "/api/erp/sales/items/export", dates: "range" },
      { key: "sales-ledger", label: "دفتر المبيعات", view: "/sales/reports/ledger", excel: "/api/erp/sales/ledger/export", dates: "range" },
      { key: "sales-aging", label: "أعمار الذمم المدينة", view: "/sales/aging", excel: "/api/erp/sales/aging/export", dates: "asOf" },
    ],
  },
  {
    key: "purchases",
    label: "المشتريات والموردون",
    icon: "Truck",
    reports: [
      { key: "purch-suppliers", label: "ترتيب الموردين", view: "/purchases/reports/suppliers", excel: "/api/erp/purchases/suppliers/export", dates: "range" },
      { key: "purch-ledger", label: "دفتر المشتريات", view: "/purchases/reports/ledger", excel: "/api/erp/purchases/ledger/export", dates: "range" },
      { key: "purch-aging", label: "أعمار الذمم الدائنة", view: "/purchases/aging", excel: "/api/erp/purchases/aging/export", dates: "asOf" },
    ],
  },
  {
    key: "inventory",
    label: "المخزون",
    icon: "Boxes",
    reports: [
      { key: "inv-stock", label: "أرصدة المخزون", view: "/inventory/stock", excel: "/api/erp/inventory/stock/export", dates: "none" },
      { key: "inv-ledger", label: "دفتر حركة المخزون", view: "/inventory/ledger", excel: "/api/erp/inventory/ledger/export", dates: "range" },
      { key: "inv-dead", label: "المخزون الراكد", view: "/inventory/dead-stock", excel: "/api/erp/inventory/dead-stock/export", dates: "none" },
      { key: "inv-expiry", label: "تنبيهات انتهاء الصلاحية", view: "/inventory/expiry", excel: "/api/erp/inventory/expiry/export", dates: "none" },
    ],
  },
  {
    key: "hr",
    label: "الموارد البشرية",
    icon: "UsersRound",
    reports: [
      { key: "hr-leaves", label: "أرصدة الإجازات", view: "/hr/leaves/report", excel: "/api/erp/hr/leaves/report/export", dates: "range" },
    ],
  },
];

/** Build the query string for a report from the chosen dates. */
export function reportQuery(dates: ReportDates, from: string, to: string): string {
  const p = new URLSearchParams();
  if (dates === "range") { if (from) p.set("from", from); if (to) p.set("to", to); }
  else if (dates === "asOf") { if (to) { p.set("asOf", to); p.set("to", to); } } // aging uses asOf, balance-sheet uses to
  return p.toString();
}
