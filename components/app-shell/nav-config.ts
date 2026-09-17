import { ACADEMY_CAPABILITY } from "@/lib/erp/academy-core";

export type NavItem = {
  label: string;
  href: string;
  icon: string; // lucide icon name
  // `erp.<module>.<action>` → checked against the member's ERP org permissions;
  // any other value → the platform OS capability. Interpreted by NavList.navAllows.
  capability?: string;
  exact?: boolean;
  group?: string; // optional sub-header within a module (Odoo-style grouping)
};

export type NavSection = {
  heading?: string; // module name. When set, the group is collapsible (heading toggles it).
  href?: string; // module overview/landing — clicking the heading label navigates here
  capability?: string; // gates the whole module (heading) — hidden when the member lacks it
  icon?: string; // module (lucide) icon shown next to the heading
  // Tile colour in the app launcher. Odoo and Frappe colour every app icon because the
  // eye finds a colour before it reads a word — with a dozen modules that is the
  // difference between scanning and searching. Sidebar rows stay monochrome.
  color?: string;
  moduleKey?: string; // subscription module gate; hidden when the tenant lacks it
  dynamicKey?: "platforms"; // group whose items are augmented at render from live data
  items: NavItem[];
};

// One unified product. Every heading is a MODULE; CRM is a module peer to
// Accounting / Inventory / Sales / Purchases / Investors — not a separate app.
// All modules are scoped to the active organization (the single tenant).
//
// Two rules this list is held to, because it drifted badly enough to be unreadable
// (98 pages under 21 sub-headers, four of which held one or two pages):
//
//   1. A `group` earns its header at THREE pages. Below that the header costs a row
//      to say nothing, so those pages join a neighbouring group instead.
//   2. A label is at most 16 characters. The sidebar is 256px wide and Arabic is not
//      terse; anything longer is read as an ellipsis. The handful of exceptions are
//      terms that lose their meaning when shortened — they're listed in the test.
//
// `nav-config.test.ts` enforces both, so the next person to add a page can't quietly
// undo this.
export const NAV: NavSection[] = [
  {
    items: [
      { label: "لوحة التحكم", href: "/dashboard", icon: "LayoutDashboard", exact: true },
      // Manager approvals + stuck documents: work that belongs to no single module.
      { label: "الموافقات", href: "/approvals", icon: "ClipboardCheck" },
    ],
  },
  {
    // Cross-cutting hub: platforms/channels tie sales + inventory + accounts together.
    // Amazon has a deeper operational surface than a normal sales channel, so its live
    // entry expands into its daily tools (in NavList). This keeps Buy Box, FBA, sync and
    // settlement work one click away without leaking Amazon-only rows to other channels.
    heading: "المنصات",
    color: "bg-violet-500",
    href: "/platforms",
    capability: "erp.sales.view",
    moduleKey: "marketplace",
    icon: "Store",
    dynamicKey: "platforms",
    items: [
      { label: "مرتجعات المنصات", href: "/sales/marketplace-returns", icon: "Undo2", capability: "erp.sales.view", group: "المتابعة" },
      { label: "أوامر السحب", href: "/sales/marketplace-removals", icon: "PackageX", capability: "erp.sales.view", group: "المتابعة" },
      { label: "التعويضات", href: "/sales/marketplace-reimbursements", icon: "HandCoins", capability: "erp.accounting.view", group: "المتابعة" },
      // A redirect, not a page: it finds this tenant's Amazon platform and opens its
      // settlement import. Keeps the row working without hard-coding a platform code.
      { label: "تسويات المنصات", href: "/sales/orders/settlements", icon: "Scale", capability: "erp.accounting.create", group: "المال والمخزون" },
      { label: "ربحية المنصات", href: "/sales/reports/marketplace-pnl", icon: "Wallet", capability: "erp.reports.view", group: "المال والمخزون" },
      { label: "مطابقة FBA", href: "/inventory/reconciliation", icon: "ClipboardCheck", capability: "erp.inventory.view", group: "المال والمخزون" },
    ],
  },
  {
    heading: "المحاسبة",
    color: "bg-sky-600",
    href: "/accounting",
    capability: "erp.accounting.view",
    moduleKey: "accounting",
    icon: "Calculator",
    items: [
      { label: "دليل الحسابات", href: "/accounting/chart", icon: "Calculator", capability: "erp.accounting.view", group: "القيود والأستاذ" },
      { label: "القيود اليومية", href: "/accounting/journal", icon: "BookText", capability: "erp.accounting.view", group: "القيود والأستاذ" },
      { label: "القيود المتكررة", href: "/accounting/recurring-journals", icon: "Repeat", capability: "erp.accounting.view", group: "القيود والأستاذ" },
      { label: "دفتر الأستاذ", href: "/accounting/ledger", icon: "BookOpen", capability: "erp.accounting.view", group: "القيود والأستاذ" },

      // Receivables (1 page), payables (2) and banks (2) were three headers over five
      // pages. They are all "who owes what and through which account", so they're one.
      // Named for what they are, not for the party: "العملاء"/"الموردون" belong to the
      // master files under المبيعات/المشتريات, and two things sharing a nav label is
      // how you end up clicking the wrong one.
      { label: "كشف حساب العميل", href: "/accounting/customer-statement", icon: "ScrollText", capability: "erp.accounting.view", group: "الكشوف والبنوك" },
      { label: "كشف حساب المورّد", href: "/accounting/supplier-statement", icon: "ScrollText", capability: "erp.accounting.view", group: "الكشوف والبنوك" },
      { label: "خطة السداد", href: "/purchases/payment-plan", icon: "CalendarClock", capability: "erp.purchases.view", group: "الكشوف والبنوك" },
      { label: "البنوك", href: "/accounting/banks", icon: "Landmark", capability: "erp.accounting.view", group: "الكشوف والبنوك" },
      { label: "المطابقة البنكية", href: "/accounting/reconciliation", icon: "ListChecks", capability: "erp.accounting.view", group: "الكشوف والبنوك" },

      { label: "المصروفات", href: "/accounting/expenses", icon: "Wallet", capability: "erp.accounting.view", group: "المصروفات والأصول" },
      { label: "العُهد", href: "/accounting/custody", icon: "HandCoins", capability: "erp.accounting.view", group: "المصروفات والأصول" },
      { label: "الأصول الثابتة", href: "/accounting/assets", icon: "Building2", capability: "erp.accounting.view", group: "المصروفات والأصول" },
      // A project is a cost dimension like a cost centre, so it belongs beside the other
      // places cost lands — not as a top-level heading holding a single link.
      { label: "المشاريع", href: "/projects", icon: "FolderKanban", capability: "erp.accounting.view", group: "المصروفات والأصول" },

      { label: "القوائم المالية", href: "/reports", icon: "FileSpreadsheet", capability: "erp.accounting.view", group: "التقارير والإعداد" },
      // "تحليل الديون المتأخرة" said in five words what accountants call aging.
      { label: "أعمار الديون", href: "/accounting/aging", icon: "CalendarClock", capability: "erp.accounting.view", group: "التقارير والإعداد" },
      { label: "التدفق النقدي", href: "/accounting/cashflow-forecast", icon: "TrendingUp", capability: "erp.reports.view", group: "التقارير والإعداد" },
      { label: "مطابقة المراقبة", href: "/accounting/control-reconciliation", icon: "Scale", capability: "erp.reports.view", group: "التقارير والإعداد" },
      { label: "مراكز التكلفة", href: "/accounting/cost-centers", icon: "Target", capability: "erp.accounting.view", group: "التقارير والإعداد" },
      { label: "الفترات المالية", href: "/accounting/periods", icon: "Lock", capability: "erp.accounting.view", group: "التقارير والإعداد" },
      // "الميزانية التقديرية" reads as the balance sheet to half the people who see it.
      { label: "الموازنة", href: "/accounting/budget", icon: "PieChart", capability: "erp.accounting.view", group: "التقارير والإعداد" },
    ],
  },
  {
    heading: "المشتريات",
    color: "bg-amber-600",
    href: "/purchases",
    capability: "erp.purchases.view",
    moduleKey: "purchases",
    icon: "Truck",
    items: [
      { label: "طلبات المواد", href: "/purchases/requisitions", icon: "ClipboardList", capability: "erp.purchases.view", group: "دورة الشراء" },
      // Not "طلبات عروض الأسعار": that is one letter away from the sales quotation and
      // they are opposite ends of the same word.
      { label: "طلب عرض سعر", href: "/purchases/rfqs", icon: "GitCompare", capability: "erp.purchases.view", group: "دورة الشراء" },
      { label: "أوامر الشراء", href: "/purchases/orders", icon: "ClipboardList", capability: "erp.purchases.view", group: "دورة الشراء" },
      { label: "إذون الاستلام", href: "/purchases/receipts", icon: "PackageCheck", capability: "erp.purchases.view", group: "دورة الشراء" },
      { label: "فواتير الشراء", href: "/purchases/invoices", icon: "ReceiptText", capability: "erp.purchases.view", group: "دورة الشراء" },
      { label: "قراءة الفواتير", href: "/purchases/read-bill", icon: "ScanText", capability: "erp.purchases.view", group: "دورة الشراء" },
      { label: "تكاليف الاستيراد", href: "/purchases/landed-costs", icon: "Ship", capability: "erp.purchases.create", group: "دورة الشراء" },
      { label: "سندات الصرف", href: "/purchases/payments", icon: "Banknote", capability: "erp.purchases.view", group: "دورة الشراء" },
      // GRNI is where the cycle fails to close, so it belongs in the cycle, not in a
      // reports drawer you visit once a quarter.
      { label: "بضاعة لم تُفوتر", href: "/purchases/grni", icon: "Scale", capability: "erp.purchases.view", group: "دورة الشراء" },

      // The supplier master. It used to have no entry at all — /purchases *was* the
      // supplier list, so the only way in was clicking the module heading.
      { label: "الموردون", href: "/purchases/suppliers", icon: "Truck", capability: "erp.purchases.view", group: "الموردون والتقارير" },
      { label: "تقييم الموردين", href: "/purchases/suppliers/rating", icon: "Star", capability: "erp.purchases.view", group: "الموردون والتقارير" },
      { label: "دفتر المشتريات", href: "/purchases/reports/ledger", icon: "BookOpen", capability: "erp.purchases.view", group: "الموردون والتقارير" },
      { label: "ترتيب الموردين", href: "/purchases/reports/suppliers", icon: "Users", capability: "erp.purchases.view", group: "الموردون والتقارير" },
    ],
  },
  {
    heading: "المخزون",
    color: "bg-teal-600",
    href: "/inventory",
    capability: "erp.inventory.view",
    moduleKey: "inventory",
    icon: "Warehouse",
    items: [
      { label: "الأصناف", href: "/inventory/items", icon: "Package", capability: "erp.inventory.view", group: "الأصناف والأرصدة" },
      { label: "المخازن", href: "/inventory/warehouses", icon: "Warehouse", capability: "erp.inventory.view", group: "الأصناف والأرصدة" },
      { label: "أرصدة المخزون", href: "/inventory/stock", icon: "Boxes", capability: "erp.inventory.view", group: "الأصناف والأرصدة" },
      { label: "حركة المخزون", href: "/inventory/ledger", icon: "ScrollText", capability: "erp.inventory.view", group: "الأصناف والأرصدة" },
      { label: "الأرقام التسلسلية", href: "/inventory/serials", icon: "ScanBarcode", capability: "erp.inventory.view", group: "الأصناف والأرصدة" },
      { label: "مواقع التخزين", href: "/inventory/bins", icon: "Grid3x3", capability: "erp.inventory.view", group: "الأصناف والأرصدة" },
      { label: "تقييم المخزون", href: "/inventory/valuation", icon: "Scale", capability: "erp.inventory.view", group: "الأصناف والأرصدة" },

      // Receipts and deliveries appear here AND in purchases/sales on purpose: the same
      // document is a purchase step and a warehouse operation, and the storeman looks
      // for it where he works. Odoo lists them twice for the same reason.
      { label: "إذون الاستلام", href: "/purchases/receipts", icon: "PackageCheck", capability: "erp.purchases.view", group: "العمليات" },
      { label: "إذون الصرف", href: "/sales/deliveries", icon: "Truck", capability: "erp.sales.view", group: "العمليات" },
      { label: "تسويات المخزون", href: "/inventory/adjustments", icon: "ClipboardCheck", capability: "erp.inventory.view", group: "العمليات" },
      { label: "الجرد الدوري", href: "/inventory/cycle-count", icon: "ListChecks", capability: "erp.inventory.view", group: "العمليات" },
      { label: "جولات التجهيز", href: "/inventory/pick-lists", icon: "ScanLine", capability: "erp.inventory.view", group: "العمليات" },
      { label: "فحص الجودة", href: "/inventory/quality", icon: "ShieldCheck", capability: "erp.inventory.view", group: "العمليات" },
      { label: "التحويلات", href: "/inventory/transfers", icon: "ArrowLeftRight", capability: "erp.inventory.view", group: "العمليات" },
      { label: "الحزم", href: "/inventory/bundles", icon: "Boxes", capability: "erp.inventory.view", group: "العمليات" },
      // Printing labels is something you DO to stock, not a warning about it.
      { label: "الباركود", href: "/inventory/labels", icon: "Barcode", capability: "erp.inventory.view", group: "العمليات" },

      // Four things that tell you stock is wrong or about to be. Nothing else.
      { label: "مطابقة FBA", href: "/inventory/reconciliation", icon: "ClipboardCheck", capability: "erp.inventory.view", group: "التنبيهات" },
      { label: "إعادة الطلب", href: "/inventory/reorder", icon: "TriangleAlert", capability: "erp.inventory.view", group: "التنبيهات" },
      { label: "المخزون الراكد", href: "/inventory/dead-stock", icon: "PackageX", capability: "erp.inventory.view", group: "التنبيهات" },
      { label: "انتهاء الصلاحية", href: "/inventory/expiry", icon: "CalendarClock", capability: "erp.inventory.view", group: "التنبيهات" },
    ],
  },
  {
    heading: "المبيعات",
    color: "bg-emerald-600",
    href: "/sales",
    capability: "erp.sales.view",
    moduleKey: "sales",
    icon: "ShoppingCart",
    items: [
      { label: "نقطة البيع", href: "/sales/pos", icon: "Store", capability: "erp.sales.create", group: "دورة البيع" },
      { label: "عروض الأسعار", href: "/sales/quotations", icon: "FileText", capability: "erp.sales.view", group: "دورة البيع" },
      { label: "أوامر البيع", href: "/sales/orders", icon: "ClipboardList", capability: "erp.sales.view", group: "دورة البيع" },
      { label: "إذون الصرف", href: "/sales/deliveries", icon: "Truck", capability: "erp.sales.view", group: "دورة البيع" },
      { label: "فواتير البيع", href: "/sales/invoices", icon: "ReceiptText", capability: "erp.sales.view", group: "دورة البيع" },
      { label: "المرتجعات", href: "/sales/returns", icon: "Undo2", capability: "erp.sales.view", group: "دورة البيع" },
      { label: "سندات القبض", href: "/sales/receipts", icon: "HandCoins", capability: "erp.sales.view", group: "دورة البيع" },
      { label: "الفواتير الدورية", href: "/sales/recurring", icon: "Repeat", capability: "erp.sales.view", group: "دورة البيع" },

      // The customer master — same story as الموردون above.
      { label: "العملاء", href: "/sales/customers", icon: "Users", capability: "erp.sales.view", group: "العملاء والتقارير" },
      { label: "قوائم الأسعار", href: "/sales/price-lists", icon: "Tags", capability: "erp.sales.view", group: "العملاء والتقارير" },
      { label: "العروض والولاء", href: "/sales/promotions", icon: "BadgePercent", capability: "erp.sales.view", group: "العملاء والتقارير" },
      { label: "دفتر المبيعات", href: "/sales/reports/ledger", icon: "BookOpen", capability: "erp.sales.view", group: "العملاء والتقارير" },
      // "تقرير الأصناف" didn't say it was sales per item, which is all it is.
      { label: "مبيعات الأصناف", href: "/sales/reports/items", icon: "BarChart3", capability: "erp.sales.view", group: "العملاء والتقارير" },
      { label: "ربحية المنتجات", href: "/sales/reports/profitability", icon: "TrendingUp", capability: "erp.reports.view", group: "العملاء والتقارير" },
      { label: "ترتيب العملاء", href: "/sales/reports/customers", icon: "Users", capability: "erp.sales.view", group: "العملاء والتقارير" },
      { label: "عمولات المبيعات", href: "/sales/commissions", icon: "Percent", capability: "erp.sales.view", group: "العملاء والتقارير" },
    ],
  },
  {
    // Four pages. Two sub-headers over four pages is filing for its own sake.
    heading: "المستثمرون",
    color: "bg-yellow-600",
    href: "/investors",
    capability: "erp.investors.view",
    moduleKey: "investors",
    icon: "Coins",
    items: [
      { label: "المستثمرون", href: "/investors/list", icon: "Coins", capability: "erp.investors.view" },
      { label: "المساهمات", href: "/investors/investments", icon: "PiggyBank", capability: "erp.investors.view" },
      { label: "توزيعات الأرباح", href: "/investors/distributions", icon: "PieChart", capability: "erp.investors.view" },
      { label: "السحوبات", href: "/investors/withdrawals", icon: "Banknote", capability: "erp.investors.view" },
    ],
  },
  {
    heading: "الموارد البشرية",
    color: "bg-pink-600",
    href: "/hr",
    capability: "erp.hr.view",
    moduleKey: "hr",
    icon: "UsersRound",
    items: [
      // The employee master. Like الموردون/العملاء, it had no entry — the heading
      // pointed straight at it, so the module had no landing page and /hr 404'd.
      { label: "الموظفون", href: "/hr/employees", icon: "UsersRound", capability: "erp.hr.view", group: "الموظفون والحضور" },
      { label: "الحضور", href: "/hr/attendance", icon: "Clock", capability: "erp.hr.view", group: "الموظفون والحضور" },
      { label: "الإجازات", href: "/hr/leaves", icon: "CalendarDays", capability: "erp.hr.view", group: "الموظفون والحضور" },
      { label: "تقرير الإجازات", href: "/hr/leaves/report", icon: "BarChart3", capability: "erp.hr.view", group: "الموظفون والحضور" },
      { label: "تقويم العطلات", href: "/hr/holidays", icon: "CalendarOff", capability: "erp.hr.view", group: "الموظفون والحضور" },

      { label: "الرواتب", href: "/hr/payroll", icon: "Banknote", capability: "erp.hr.view", group: "الرواتب والتطوير" },
      { label: "مطالبات المصروفات", href: "/hr/expense-claims", icon: "ReceiptText", capability: "erp.accounting.view", group: "الرواتب والتطوير" },
      { label: "التوظيف", href: "/hr/recruitment", icon: "UserPlus", capability: "erp.hr.view", group: "الرواتب والتطوير" },
      { label: "تقييم الأداء", href: "/hr/performance", icon: "Target", capability: "erp.hr.view", group: "الرواتب والتطوير" },
      { label: "التدريب", href: "/hr/training", icon: "GraduationCap", capability: "erp.hr.view", group: "الرواتب والتطوير" },
    ],
  },
  {
    heading: "التقارير",
    color: "bg-indigo-600",
    href: "/reports/center",
    capability: "erp.reports.view",
    moduleKey: "reports",
    icon: "ChartColumn",
    items: [
      { label: "التقارير", href: "/reports/center", icon: "FileText", capability: "erp.reports.view", exact: true },
      // Listed here AND under المحاسبة, like إذون الاستلام under purchases and inventory.
      // Only accounting claimed it before, so a statement opened from the reports centre
      // flipped the sidebar to accounting — or, for a tenant with reports but not
      // accounting, left the page with no module at all.
      { label: "القوائم المالية", href: "/reports", icon: "FileSpreadsheet", capability: "erp.reports.view" },
      { label: "التحليلات", href: "/reports/analytics", icon: "Activity", capability: "erp.reports.view" },
      { label: "باني التقارير", href: "/reports/builder", icon: "Table2", capability: "erp.reports.view" },
      { label: "لوحات التقارير", href: "/reports/dashboards", icon: "LayoutDashboard", capability: "erp.reports.view" },
    ],
  },
  {
    // Product documentation and support, not tenant data — no capability gate on the
    // support items: anyone signed in can read how the system works or tell us it's
    // broken.
    heading: "الدعم",
    color: "bg-cyan-600",
    // No href: the heading used to open the academy, which is hidden for now — the
    // heading just toggles the group.
    icon: "GraduationCap",
    items: [
      // Admin-only while the catalogue fills up (ACADEMY_ADMIN_ONLY). The capability
      // comes from the same flag as the page guards so the entry can't outlive the
      // pages' visibility. Remove the `capability` line when the flag flips.
      { label: "الأكاديمية", href: "/academy", icon: "GraduationCap", capability: ACADEMY_CAPABILITY },
      { label: "آخر التحديثات", href: "/whats-new", icon: "Sparkles" },
      { label: "اقتراح أو شكوى", href: "/feedback", icon: "MessageSquarePlus" },
    ],
  },
  {
    heading: "الإدارة والإعدادات",
    color: "bg-slate-600",
    icon: "ShieldCheck",
    items: [
      // Platform admin panel (/admin) is deliberately NOT linked from the tenant
      // workspace — it's a separate SaaS surface reached via its own login
      // (/login/admin) and stays server-guarded by employee.manage (system_admin).
      // The migration step: a company that already exists starts here, not at an
      // empty ledger.
      { label: "الأرصدة الافتتاحية", href: "/settings/opening-balance", icon: "Upload", capability: "erp.accounting.create" },
      // Was a section of its own holding this single item.
      { label: "استيراد وتصدير", href: "/imports", icon: "ArrowRightLeft", capability: "erp.sales.view" },
      { label: "الصلاحيات", href: "/settings/permissions", icon: "ShieldCheck", capability: "erp.settings.edit" },
      { label: "الأتمتة", href: "/automation", icon: "Workflow", capability: "erp.automation.manage" },
      { label: "سجل التدقيق", href: "/audit", icon: "ScrollText", capability: "erp.settings.edit" },
      // The setup checklist is opened from Settings; without a row here it belonged to no
      // module and lost the sidebar the moment you arrived.
      { label: "دليل الإعداد", href: "/setup", icon: "ListChecks", capability: "erp.settings.view" },
      { label: "الإعدادات", href: "/settings", icon: "Settings", capability: "erp.settings.view" },
    ],
  },
];

/**
 * Sections an owner may hide from the sidebar. Derived from NAV, so a module added
 * later shows up here without anyone remembering to update a second list.
 *
 * Display only. The subscription and the member's permissions decide ACCESS; this
 * decides what earns a row in a list that already has ninety of them.
 */
export const HIDEABLE_SECTIONS = NAV
  .filter((s) => !!s.heading && s.heading !== "الإدارة والإعدادات")
  .map((s) => s.heading as string);
