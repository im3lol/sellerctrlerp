import type { Capability } from "@/lib/rbac";

export type NavItem = {
  label: string;
  href: string;
  icon: string; // lucide icon name
  capability?: Capability; // if set, only shown when the user has it
  exact?: boolean;
  group?: string; // optional sub-header within a module (Odoo-style grouping)
};

export type NavSection = {
  heading?: string; // module name. When set, the group is collapsible (heading toggles it).
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
    icon: "Store",
    dynamicKey: "platforms",
    items: [
      { label: "كل المنصات", href: "/erp/platforms", icon: "LayoutGrid", capability: "erp.sales.view", exact: true },
    ],
  },
  {
    heading: "المحاسبة",
    moduleKey: "accounting",
    icon: "Calculator",
    items: [
      { label: "نظرة عامة", href: "/erp/accounting", icon: "LayoutDashboard", capability: "erp.accounting.view", exact: true },

      { label: "دليل الحسابات", href: "/erp/accounting/chart", icon: "Calculator", capability: "erp.accounting.view", group: "القيود والأستاذ" },
      { label: "القيود اليومية", href: "/erp/accounting/journal", icon: "BookText", capability: "erp.accounting.view", group: "القيود والأستاذ" },
      { label: "القيود المتكررة", href: "/erp/accounting/recurring-journals", icon: "Repeat", capability: "erp.accounting.view", group: "القيود والأستاذ" },
      { label: "دفتر الأستاذ", href: "/erp/accounting/ledger", icon: "BookOpen", capability: "erp.accounting.view", group: "القيود والأستاذ" },

      { label: "سندات القبض", href: "/erp/sales/receipts", icon: "HandCoins", capability: "erp.sales.view", group: "العملاء" },
      { label: "كشف حساب العميل", href: "/erp/accounting/customer-statement", icon: "ScrollText", capability: "erp.accounting.view", group: "العملاء" },

      { label: "سندات الصرف", href: "/erp/purchases/payments", icon: "Banknote", capability: "erp.purchases.view", group: "الموردون" },
      { label: "كشف حساب المورّد", href: "/erp/accounting/supplier-statement", icon: "ScrollText", capability: "erp.accounting.view", group: "الموردون" },

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
    moduleKey: "purchases",
    icon: "Truck",
    items: [
      { label: "الموردون", href: "/erp/purchases", icon: "Users", capability: "erp.purchases.view", exact: true },

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
    moduleKey: "inventory",
    icon: "Warehouse",
    items: [
      { label: "نظرة عامة", href: "/erp/inventory", icon: "LayoutDashboard", capability: "erp.inventory.view", exact: true },

      { label: "الأصناف", href: "/erp/inventory/items", icon: "Package", capability: "erp.inventory.view", group: "الأصناف والأرصدة" },
      { label: "أرصدة المخزون", href: "/erp/inventory/stock", icon: "Boxes", capability: "erp.inventory.view", group: "الأصناف والأرصدة" },
      { label: "دفتر حركة المخزون", href: "/erp/inventory/ledger", icon: "ScrollText", capability: "erp.inventory.view", group: "الأصناف والأرصدة" },
      { label: "مطابقة قيمة المخزون", href: "/erp/inventory/valuation", icon: "Scale", capability: "erp.reports.view", group: "الأصناف والأرصدة" },

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
    moduleKey: "sales",
    icon: "ShoppingCart",
    items: [
      { label: "العملاء", href: "/erp/sales", icon: "Users", capability: "erp.sales.view", exact: true },

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
    moduleKey: "investors",
    icon: "Coins",
    items: [
      { label: "نظرة عامة", href: "/erp/investors", icon: "Coins", capability: "erp.investors.view" },
    ],
  },
  {
    heading: "الموارد البشرية",
    moduleKey: "hr",
    icon: "UsersRound",
    items: [
      { label: "الموظفون",    href: "/erp/hr/employees", icon: "UserCog",       capability: "erp.hr.view" },

      { label: "الإجازات",     href: "/erp/hr/leaves",   icon: "CalendarDays",  capability: "erp.hr.view", group: "الحضور والإجازات" },
      { label: "تقويم العطلات", href: "/erp/hr/holidays", icon: "CalendarOff",   capability: "erp.hr.view", group: "الحضور والإجازات" },

      { label: "مسير الرواتب", href: "/erp/hr/payroll",   icon: "Banknote",      capability: "erp.hr.view", group: "المالية" },
      { label: "مطالبات المصروفات", href: "/erp/hr/expense-claims", icon: "ReceiptText", capability: "erp.accounting.view", group: "المالية" },
    ],
  },
  {
    heading: "التقارير والتحليلات",
    moduleKey: "reports",
    icon: "ChartColumn",
    items: [
      { label: "مركز التقارير", href: "/erp/reports/center", icon: "ChartColumn", capability: "erp.reports.view" },
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
      { label: "استيراد البيانات", href: "/erp/imports", icon: "Upload", capability: "erp.sales.view" },
    ],
  },
  {
    heading: "الإدارة والإعدادات",
    icon: "ShieldCheck",
    items: [
      { label: "لوحة الإدارة", href: "/admin", icon: "Shield", capability: "employee.manage" },
      { label: "صلاحيات المستخدمين", href: "/erp/settings/permissions", icon: "ShieldCheck", capability: "erp.settings.manage" },
      { label: "سجل التدقيق", href: "/erp/audit", icon: "ScrollText", capability: "erp.settings.manage" },
      { label: "الإعدادات", href: "/erp/settings", icon: "Settings", capability: "erp.settings.manage" },
    ],
  },
];
