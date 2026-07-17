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
  moduleKey?: string; // subscription module gate; hidden when the tenant lacks it
  dynamicKey?: "platforms"; // group whose items are augmented at render from live data
  items: NavItem[];
};

// One unified product. Every heading is a MODULE; CRM is a module peer to
// Accounting / Inventory / Sales / Purchases / Investors — not a separate app.
// All modules are scoped to the active organization (the single tenant).
export const NAV: NavSection[] = [
  {
    items: [
      { label: "لوحة التحكم", href: "/dashboard", icon: "LayoutDashboard", exact: true },
    ],
  },
  {
    // Cross-cutting hub: platforms/channels tie sales + inventory + accounts
    // together. A collapsible group whose live platforms are listed underneath.
    heading: "المنصات",
    href: "/erp/platforms",
    capability: "erp.sales.view",
    moduleKey: "marketplace",
    icon: "Store",
    dynamicKey: "platforms",
    // The heading itself opens the all-platforms page; the added platforms are
    // listed underneath (appended dynamically). No separate "كل المنصات" item.
    items: [],
  },
  {
    heading: "المحاسبة",
    href: "/erp/accounting",
    capability: "erp.accounting.view",
    moduleKey: "accounting",
    icon: "Calculator",
    items: [
      { label: "دليل الحسابات", href: "/erp/accounting/chart", icon: "Calculator", capability: "erp.accounting.view", group: "القيود والأستاذ" },
      { label: "القيود اليومية", href: "/erp/accounting/journal", icon: "BookText", capability: "erp.accounting.view", group: "القيود والأستاذ" },
      { label: "القيود المتكررة", href: "/erp/accounting/recurring-journals", icon: "Repeat", capability: "erp.accounting.view", group: "القيود والأستاذ" },
      { label: "دفتر الأستاذ", href: "/erp/accounting/ledger", icon: "BookOpen", capability: "erp.accounting.view", group: "القيود والأستاذ" },

      // Named for what they are, not for the party: "العملاء"/"الموردون" now belong to
      // the master files under المبيعات/المشتريات, and two different things sharing a
      // nav label is how you end up clicking the wrong one.
      { label: "سندات القبض", href: "/erp/sales/receipts", icon: "HandCoins", capability: "erp.sales.view", group: "الذمم المدينة" },
      { label: "كشف حساب العميل", href: "/erp/accounting/customer-statement", icon: "ScrollText", capability: "erp.accounting.view", group: "الذمم المدينة" },

      { label: "سندات الصرف", href: "/erp/purchases/payments", icon: "Banknote", capability: "erp.purchases.view", group: "الذمم الدائنة" },
      { label: "كشف حساب المورّد", href: "/erp/accounting/supplier-statement", icon: "ScrollText", capability: "erp.accounting.view", group: "الذمم الدائنة" },

      { label: "المصروفات", href: "/erp/accounting/expenses", icon: "Wallet", capability: "erp.accounting.view", group: "المصروفات والأصول" },
      { label: "الأصول الثابتة", href: "/erp/accounting/assets", icon: "Building2", capability: "erp.accounting.view", group: "المصروفات والأصول" },

      { label: "الحسابات البنكية", href: "/erp/accounting/banks", icon: "Landmark", capability: "erp.accounting.view", group: "البنوك والخزينة" },
      { label: "المطابقة البنكية", href: "/erp/accounting/reconciliation", icon: "ListChecks", capability: "erp.accounting.view", group: "البنوك والخزينة" },

      { label: "تحليل الديون المتأخرة", href: "/erp/accounting/aging", icon: "CalendarClock", capability: "erp.accounting.view", group: "التقارير والمطابقات" },
      { label: "توقّع التدفق النقدي", href: "/erp/accounting/cashflow-forecast", icon: "TrendingUp", capability: "erp.reports.view", group: "التقارير والمطابقات" },
      { label: "مطابقة حسابات المراقبة", href: "/erp/accounting/control-reconciliation", icon: "Scale", capability: "erp.reports.view", group: "التقارير والمطابقات" },

      { label: "مراكز التكلفة", href: "/erp/accounting/cost-centers", icon: "Target", capability: "erp.accounting.view", group: "الإعداد" },
      { label: "الفترات المالية", href: "/erp/accounting/periods", icon: "Lock", capability: "erp.accounting.view", group: "الإعداد" },
      { label: "الميزانية التقديرية", href: "/erp/accounting/budget", icon: "PieChart", capability: "erp.accounting.view", group: "الإعداد" },
    ],
  },
  {
    heading: "المشتريات",
    href: "/erp/purchases",
    capability: "erp.purchases.view",
    moduleKey: "purchases",
    icon: "Truck",
    items: [
      // The supplier master. It used to have no entry at all — /erp/purchases *was*
      // the supplier list, so the only way in was clicking the module heading.
      { label: "الموردون", href: "/erp/purchases/suppliers", icon: "Truck", capability: "erp.purchases.view", group: "البيانات الأساسية" },

      { label: "طلبات المواد", href: "/erp/purchases/requisitions", icon: "ClipboardList", capability: "erp.purchases.view", group: "دورة الشراء" },
      { label: "أوامر الشراء", href: "/erp/purchases/orders", icon: "ClipboardList", capability: "erp.purchases.view", group: "دورة الشراء" },
      { label: "إذون الاستلام", href: "/erp/purchases/receipts", icon: "PackageCheck", capability: "erp.purchases.view", group: "دورة الشراء" },
      { label: "فواتير الشراء", href: "/erp/purchases/invoices", icon: "ReceiptText", capability: "erp.purchases.view", group: "دورة الشراء" },

      { label: "تقرير الدفتر", href: "/erp/purchases/reports/ledger", icon: "BookOpen", capability: "erp.purchases.view", group: "التقارير" },
      { label: "ترتيب الموردين", href: "/erp/purchases/reports/suppliers", icon: "Users", capability: "erp.purchases.view", group: "التقارير" },
    ],
  },
  {
    heading: "المخزون",
    href: "/erp/inventory",
    capability: "erp.inventory.view",
    moduleKey: "inventory",
    icon: "Warehouse",
    items: [
      { label: "الأصناف", href: "/erp/inventory/items", icon: "Package", capability: "erp.inventory.view", group: "الأصناف والأرصدة" },
      { label: "أرصدة المخزون", href: "/erp/inventory/stock", icon: "Boxes", capability: "erp.inventory.view", group: "الأصناف والأرصدة" },
      { label: "دفتر حركة المخزون", href: "/erp/inventory/ledger", icon: "ScrollText", capability: "erp.inventory.view", group: "الأصناف والأرصدة" },
      { label: "مطابقة قيمة المخزون", href: "/erp/inventory/valuation", icon: "Scale", capability: "erp.inventory.view", group: "الأصناف والأرصدة" },

      { label: "إذون الاستلام", href: "/erp/purchases/receipts", icon: "PackageCheck", capability: "erp.purchases.view", group: "العمليات" },
      { label: "إذون الصرف", href: "/erp/sales/deliveries", icon: "Truck", capability: "erp.sales.view", group: "العمليات" },
      { label: "تسويات المخزون", href: "/erp/inventory/adjustments", icon: "ClipboardCheck", capability: "erp.inventory.view", group: "العمليات" },
      { label: "التحويلات المخزنية", href: "/erp/inventory/transfers", icon: "ArrowLeftRight", capability: "erp.inventory.view", group: "العمليات" },
      { label: "الحزم والمجموعات", href: "/erp/inventory/bundles", icon: "Boxes", capability: "erp.inventory.view", group: "العمليات" },

      { label: "تنبيهات إعادة الطلب", href: "/erp/inventory/reorder", icon: "TriangleAlert", capability: "erp.inventory.view", group: "التنبيهات والأدوات" },
      { label: "المخزون الراكد", href: "/erp/inventory/dead-stock", icon: "PackageX", capability: "erp.inventory.view", group: "التنبيهات والأدوات" },
      { label: "تنبيهات انتهاء الصلاحية", href: "/erp/inventory/expiry", icon: "CalendarClock", capability: "erp.inventory.view", group: "التنبيهات والأدوات" },
      { label: "ملصقات الباركود", href: "/erp/inventory/labels", icon: "Barcode", capability: "erp.inventory.view", group: "التنبيهات والأدوات" },
    ],
  },
  {
    heading: "المبيعات",
    href: "/erp/sales",
    capability: "erp.sales.view",
    moduleKey: "sales",
    icon: "ShoppingCart",
    items: [
      // The customer master — same story as الموردون above.
      { label: "العملاء", href: "/erp/sales/customers", icon: "Users", capability: "erp.sales.view", group: "البيانات الأساسية" },

      { label: "عروض الأسعار", href: "/erp/sales/quotations", icon: "FileText", capability: "erp.sales.view", group: "دورة البيع" },
      { label: "أوامر البيع", href: "/erp/sales/orders", icon: "ClipboardList", capability: "erp.sales.view", group: "دورة البيع" },
      { label: "فواتير البيع", href: "/erp/sales/invoices", icon: "ReceiptText", capability: "erp.sales.view", group: "دورة البيع" },
      { label: "الفواتير الدورية", href: "/erp/sales/recurring", icon: "Repeat", capability: "erp.sales.view", group: "دورة البيع" },

      { label: "تقرير الدفتر", href: "/erp/sales/reports/ledger", icon: "BookOpen", capability: "erp.sales.view", group: "التقارير" },
      { label: "تقرير الأصناف", href: "/erp/sales/reports/items", icon: "BarChart3", capability: "erp.sales.view", group: "التقارير" },
      { label: "ربحية المنتجات", href: "/erp/sales/reports/profitability", icon: "TrendingUp", capability: "erp.reports.view", group: "التقارير" },
      { label: "ترتيب العملاء", href: "/erp/sales/reports/customers", icon: "Users", capability: "erp.sales.view", group: "التقارير" },
    ],
  },
  {
    heading: "المستثمرون",
    href: "/erp/investors",
    capability: "erp.investors.view",
    moduleKey: "investors",
    icon: "Coins",
    items: [
      { label: "المستثمرون", href: "/erp/investors/list", icon: "Coins", capability: "erp.investors.view", group: "البيانات الأساسية" },

      { label: "مساهمات رأس المال", href: "/erp/investors/investments", icon: "PiggyBank", capability: "erp.investors.view", group: "حقوق الملكية" },
      { label: "توزيعات الأرباح", href: "/erp/investors/distributions", icon: "PieChart", capability: "erp.investors.view", group: "حقوق الملكية" },
      { label: "السحوبات", href: "/erp/investors/withdrawals", icon: "Banknote", capability: "erp.investors.view", group: "حقوق الملكية" },
    ],
  },
  {
    heading: "الموارد البشرية",
    href: "/erp/hr",
    capability: "erp.hr.view",
    moduleKey: "hr",
    icon: "UsersRound",
    items: [
      // The employee master. Like الموردون/العملاء, it had no entry — the heading
      // pointed straight at it, so the module had no landing page and /erp/hr 404'd.
      { label: "الموظفون",     href: "/erp/hr/employees", icon: "UsersRound",  capability: "erp.hr.view", group: "البيانات الأساسية" },

      { label: "الإجازات",     href: "/erp/hr/leaves",   icon: "CalendarDays",  capability: "erp.hr.view", group: "الحضور والإجازات" },
      { label: "تقرير الإجازات", href: "/erp/hr/leaves/report", icon: "BarChart3", capability: "erp.hr.view", group: "الحضور والإجازات" },
      { label: "تقويم العطلات", href: "/erp/hr/holidays", icon: "CalendarOff",   capability: "erp.hr.view", group: "الحضور والإجازات" },

      { label: "مسير الرواتب", href: "/erp/hr/payroll",   icon: "Banknote",      capability: "erp.hr.view", group: "المالية" },
      { label: "مطالبات المصروفات", href: "/erp/hr/expense-claims", icon: "ReceiptText", capability: "erp.accounting.view", group: "المالية" },
    ],
  },
  {
    heading: "التقارير والتحليلات",
    href: "/erp/reports/center",
    capability: "erp.reports.view",
    moduleKey: "reports",
    icon: "ChartColumn",
    items: [
      { label: "ميزان المراجعة", href: "/erp/reports", icon: "ChartPie", capability: "erp.reports.view", exact: true },

      { label: "قائمة الدخل", href: "/erp/reports/income-statement", icon: "TrendingUp", capability: "erp.reports.view", group: "القوائم المالية" },
      { label: "الميزانية العمومية", href: "/erp/reports/balance-sheet", icon: "Scale", capability: "erp.reports.view", group: "القوائم المالية" },
      { label: "التدفق النقدي", href: "/erp/reports/cash-flow", icon: "ArrowLeftRight", capability: "erp.reports.view", group: "القوائم المالية" },
      { label: "ضريبة القيمة المضافة", href: "/erp/reports/vat", icon: "Percent", capability: "erp.reports.view", group: "القوائم المالية" },

      { label: "المؤشرات المالية", href: "/erp/reports/ratios", icon: "Activity", capability: "erp.reports.view", group: "التحليلات" },
      { label: "أرباح مراكز التكلفة", href: "/erp/reports/cost-centers", icon: "Target", capability: "erp.reports.view", group: "التحليلات" },
      { label: "إعادة تقييم العملات", href: "/erp/reports/fx-revaluation", icon: "BadgeDollarSign", capability: "erp.reports.view", group: "التحليلات" },
    ],
  },
  {
    heading: "الأدوات",
    icon: "Wrench",
    items: [
      { label: "الاستيراد والتصدير", href: "/erp/imports", icon: "ArrowRightLeft", capability: "erp.sales.view" },
    ],
  },
  {
    // Product documentation and support, not tenant data — no capability gate on the
    // support items: anyone signed in can read how the system works or tell us it's
    // broken.
    heading: "الدعم",
    // No href: the heading used to open the academy, which is hidden for now — the
    // heading just toggles the group.
    icon: "GraduationCap",
    items: [
      // Admin-only while the catalogue fills up (ACADEMY_ADMIN_ONLY). The capability
      // comes from the same flag as the page guards so the entry can't outlive the
      // pages' visibility. Remove the `capability` line when the flag flips.
      { label: "الأكاديمية", href: "/erp/academy", icon: "GraduationCap", capability: ACADEMY_CAPABILITY },
      { label: "آخر التحديثات", href: "/erp/whats-new", icon: "Sparkles" },
      { label: "اقتراح أو شكوى", href: "/erp/feedback", icon: "MessageSquarePlus" },
    ],
  },
  {
    heading: "الإدارة والإعدادات",
    icon: "ShieldCheck",
    items: [
      // Platform admin panel (/admin) is deliberately NOT linked from the tenant
      // workspace — it's a separate SaaS surface reached via its own login
      // (/login/admin) and stays server-guarded by employee.manage (system_admin).
      // The migration step: a company that already exists starts here, not at an
      // empty ledger.
      { label: "الأرصدة الافتتاحية", href: "/erp/settings/opening-balance", icon: "Upload", capability: "erp.accounting.create" },
      { label: "صلاحيات المستخدمين", href: "/erp/settings/permissions", icon: "ShieldCheck", capability: "erp.settings.edit" },
      { label: "سجل التدقيق", href: "/erp/audit", icon: "ScrollText", capability: "erp.settings.edit" },
      { label: "الإعدادات", href: "/erp/settings", icon: "Settings", capability: "erp.settings.edit" },
    ],
  },
];
