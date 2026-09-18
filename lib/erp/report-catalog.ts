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
  /**
   * The A4 print view, or null when there isn't one. These all live under `/erp/...`
   * because the (print) route group kept the old prefix when the app dropped it — five
   * pages had hand-written `/reports/<x>/print` and every one of them was a 404.
   */
  print?: string | null;
  dates: ReportDates;
};

export type ReportModule = { key: string; label: string; icon: string; reports: CatalogReport[] };

export const REPORT_MODULES: ReportModule[] = [
  {
    key: "accounting",
    label: "المحاسبة والمالية",
    icon: "Calculator",
    reports: [
      { key: "trial-balance", label: "ميزان المراجعة", view: "/reports", excel: "/api/erp/reports/trial-balance/export", print: "/erp/reports/trial-balance/print", dates: "range" },
      { key: "income-statement", label: "قائمة الدخل", view: "/reports/income-statement", excel: "/api/erp/reports/income-statement/export", print: "/erp/reports/income-statement/print", dates: "range" },
      { key: "balance-sheet", label: "الميزانية العمومية", view: "/reports/balance-sheet", excel: "/api/erp/reports/balance-sheet/export", print: "/erp/reports/balance-sheet/print", dates: "asOf" },
      { key: "cash-flow", label: "التدفق النقدي", view: "/reports/cash-flow", excel: "/api/erp/reports/cash-flow/export", print: "/erp/reports/cash-flow/print", dates: "range" },
      { key: "vat", label: "ضريبة القيمة المضافة", view: "/reports/vat", excel: "/api/erp/reports/vat/export", print: "/erp/reports/vat/print", dates: "range" },
      { key: "ratios", label: "المؤشرات المالية", view: "/reports/ratios", excel: "/api/erp/reports/ratios/export", print: "/erp/reports/ratios/print", dates: "none" },
      { key: "cost-centers", label: "أرباح مراكز التكلفة", view: "/reports/cost-centers", excel: "/api/erp/reports/cost-centers/export", print: "/erp/reports/cost-centers/print", dates: "range" },
      { key: "fx", label: "إعادة تقييم العملات", view: "/reports/fx-revaluation", excel: "/api/erp/reports/fx-revaluation/export", print: "/erp/reports/fx-revaluation/print", dates: "none" },
      // Both statements have a print view and no Excel route. They were missing from
      // the catalogue entirely, so the report switcher couldn't reach them.
      { key: "customer-statement", label: "كشف حساب العميل", view: "/accounting/customer-statement", excel: "/api/erp/accounting/party-statement/export", print: "/erp/accounting/customer-statement/print", dates: "range" },
      { key: "supplier-statement", label: "كشف حساب المورّد", view: "/accounting/supplier-statement", excel: "/api/erp/accounting/party-statement/export", print: "/erp/accounting/supplier-statement/print", dates: "range" },
    ],
  },
  {
    key: "sales",
    label: "المبيعات والعملاء",
    icon: "ShoppingCart",
    reports: [
      { key: "sales-profit", label: "ربحية المنتجات", view: "/sales/reports/profitability", excel: "/api/erp/sales/profitability/export", print: "/erp/sales/reports/profitability/print", dates: "range" },
      { key: "sales-customers", label: "ترتيب العملاء", view: "/sales/reports/customers", excel: "/api/erp/sales/customers/export", print: "/erp/sales/reports/customers/print", dates: "range" },
      { key: "sales-items", label: "تقرير أصناف المبيعات", view: "/sales/reports/items", excel: "/api/erp/sales/items/export", print: "/erp/sales/reports/items/print", dates: "range" },
      { key: "sales-ledger", label: "دفتر المبيعات", view: "/sales/reports/ledger", excel: "/api/erp/sales/ledger/export", print: "/erp/sales/reports/ledger/print", dates: "range" },
      { key: "sales-aging", label: "أعمار الذمم المدينة", view: "/sales/aging", excel: "/api/erp/sales/aging/export", print: "/erp/sales/aging/print", dates: "asOf" },
      { key: "pos-shifts", label: "ورديات نقطة البيع", view: "/sales/pos", excel: "/api/erp/exports/pos-shifts", dates: "none" },
      { key: "promotions", label: "العروض", view: "/sales/promotions", excel: "/api/erp/exports/promotions", dates: "none" },
    ],
  },
  {
    key: "purchases",
    label: "المشتريات والموردون",
    icon: "Truck",
    reports: [
      { key: "purch-suppliers", label: "ترتيب الموردين", view: "/purchases/reports/suppliers", excel: "/api/erp/purchases/suppliers/export", print: "/erp/purchases/reports/suppliers/print", dates: "range" },
      { key: "purch-ledger", label: "دفتر المشتريات", view: "/purchases/reports/ledger", excel: "/api/erp/purchases/ledger/export", print: "/erp/purchases/reports/ledger/print", dates: "range" },
      { key: "purch-aging", label: "أعمار الذمم الدائنة", view: "/purchases/aging", excel: "/api/erp/purchases/aging/export", print: "/erp/purchases/aging/print", dates: "asOf" },
    ],
  },
  {
    key: "inventory",
    label: "المخزون",
    icon: "Boxes",
    reports: [
      { key: "inv-stock", label: "أرصدة المخزون", view: "/inventory/stock", excel: "/api/erp/inventory/stock/export", print: "/erp/inventory/stock/print", dates: "none" },
      { key: "inv-ledger", label: "دفتر حركة المخزون", view: "/inventory/ledger", excel: "/api/erp/inventory/ledger/export", print: "/erp/inventory/ledger/print", dates: "range" },
      { key: "inv-dead", label: "المخزون الراكد", view: "/inventory/dead-stock", excel: "/api/erp/inventory/dead-stock/export", print: "/erp/inventory/dead-stock/print", dates: "none" },
      { key: "inv-expiry", label: "تنبيهات انتهاء الصلاحية", view: "/inventory/expiry", excel: "/api/erp/inventory/expiry/export", print: "/erp/inventory/expiry/print", dates: "none" },
    ],
  },
  {
    key: "hr",
    label: "الموارد البشرية",
    icon: "UsersRound",
    reports: [
      { key: "hr-leaves", label: "أرصدة الإجازات", view: "/hr/leaves/report", excel: "/api/erp/hr/leaves/report/export", print: "/erp/hr/leaves/report/print", dates: "range" },
      { key: "applicants", label: "المتقدّمون للوظائف", view: "/hr/recruitment", excel: "/api/erp/exports/applicants", dates: "none" },
      { key: "training-courses", label: "الكورسات التدريبية", view: "/hr/training", excel: "/api/erp/exports/training-courses", dates: "none" },
    ],
  },
  {
    // A project is a cost dimension and an asset is a fixed_assets row, so both hang off
    // accounting — but someone looking for "what did this project cost" does not think of
    // that as an accounting report, so it gets its own heading.
    key: "operations",
    label: "المشاريع والأصول",
    icon: "FolderKanban",
    reports: [
      { key: "projects", label: "المشاريع", view: "/projects", excel: "/api/erp/exports/projects", dates: "none" },
      { key: "timesheets", label: "ساعات العمل", view: "/projects", excel: "/api/erp/exports/timesheets", dates: "none" },
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
