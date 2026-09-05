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
    href: "/platforms",
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
    href: "/accounting",
    capability: "erp.accounting.view",
    moduleKey: "accounting",
    icon: "Calculator",
    items: [
      { label: "دليل الحسابات", href: "/accounting/chart", icon: "Calculator", capability: "erp.accounting.view", group: "القيود والأستاذ" },
      { label: "القيود اليومية", href: "/accounting/journal", icon: "BookText", capability: "erp.accounting.view", group: "القيود والأستاذ" },
      { label: "القيود المتكررة", href: "/accounting/recurring-journals", icon: "Repeat", capability: "erp.accounting.view", group: "القيود والأستاذ" },
      { label: "دفتر الأستاذ", href: "/accounting/ledger", icon: "BookOpen", capability: "erp.accounting.view", group: "القيود والأستاذ" },

      // Named for what they are, not for the party: "العملاء"/"الموردون" now belong to
      // the master files under المبيعات/المشتريات, and two different things sharing a
      // nav label is how you end up clicking the wrong one.
      { label: "سندات القبض", href: "/sales/receipts", icon: "HandCoins", capability: "erp.sales.view", group: "الذمم المدينة" },
      { label: "كشف حساب العميل", href: "/accounting/customer-statement", icon: "ScrollText", capability: "erp.accounting.view", group: "الذمم المدينة" },

      { label: "سندات الصرف", href: "/purchases/payments", icon: "Banknote", capability: "erp.purchases.view", group: "الذمم الدائنة" },
      { label: "خطة السداد", href: "/purchases/payment-plan", icon: "CalendarClock", capability: "erp.purchases.view", group: "الذمم الدائنة" },
      { label: "كشف حساب المورّد", href: "/accounting/supplier-statement", icon: "ScrollText", capability: "erp.accounting.view", group: "الذمم الدائنة" },

      { label: "المصروفات", href: "/accounting/expenses", icon: "Wallet", capability: "erp.accounting.view", group: "المصروفات والأصول" },
      { label: "العُهد", href: "/accounting/custody", icon: "HandCoins", capability: "erp.accounting.view", group: "المصروفات والأصول" },
      { label: "الأصول الثابتة", href: "/accounting/assets", icon: "Building2", capability: "erp.accounting.view", group: "المصروفات والأصول" },

      { label: "الحسابات البنكية", href: "/accounting/banks", icon: "Landmark", capability: "erp.accounting.view", group: "البنوك والخزينة" },
      { label: "المطابقة البنكية", href: "/accounting/reconciliation", icon: "ListChecks", capability: "erp.accounting.view", group: "البنوك والخزينة" },

      { label: "تحليل الديون المتأخرة", href: "/accounting/aging", icon: "CalendarClock", capability: "erp.accounting.view", group: "التقارير والمطابقات" },
      { label: "توقّع التدفق النقدي", href: "/accounting/cashflow-forecast", icon: "TrendingUp", capability: "erp.reports.view", group: "التقارير والمطابقات" },
      { label: "مطابقة حسابات المراقبة", href: "/accounting/control-reconciliation", icon: "Scale", capability: "erp.reports.view", group: "التقارير والمطابقات" },

      { label: "مراكز التكلفة", href: "/accounting/cost-centers", icon: "Target", capability: "erp.accounting.view", group: "الإعداد" },
      { label: "الفترات المالية", href: "/accounting/periods", icon: "Lock", capability: "erp.accounting.view", group: "الإعداد" },
      { label: "الميزانية التقديرية", href: "/accounting/budget", icon: "PieChart", capability: "erp.accounting.view", group: "الإعداد" },
    ],
  },
  {
    heading: "المشتريات",
    href: "/purchases",
    capability: "erp.purchases.view",
    moduleKey: "purchases",
    icon: "Truck",
    items: [
      // The supplier master. It used to have no entry at all — /erp/purchases *was*
      // the supplier list, so the only way in was clicking the module heading.
      { label: "الموردون", href: "/purchases/suppliers", icon: "Truck", capability: "erp.purchases.view", group: "البيانات الأساسية" },
      { label: "تقييم الموردين", href: "/purchases/suppliers/rating", icon: "Star", capability: "erp.purchases.view", group: "البيانات الأساسية" },

      { label: "طلبات المواد", href: "/purchases/requisitions", icon: "ClipboardList", capability: "erp.purchases.view", group: "دورة الشراء" },
      { label: "طلبات عروض الأسعار", href: "/purchases/rfqs", icon: "GitCompare", capability: "erp.purchases.view", group: "دورة الشراء" },
      { label: "أوامر الشراء", href: "/purchases/orders", icon: "ClipboardList", capability: "erp.purchases.view", group: "دورة الشراء" },
      { label: "إذون الاستلام", href: "/purchases/receipts", icon: "PackageCheck", capability: "erp.purchases.view", group: "دورة الشراء" },
      { label: "فواتير الشراء", href: "/purchases/invoices", icon: "ReceiptText", capability: "erp.purchases.view", group: "دورة الشراء" },
      { label: "تكاليف الاستيراد", href: "/purchases/landed-costs", icon: "Ship", capability: "erp.purchases.create", group: "دورة الشراء" },

      { label: "مطابقة بضاعة لم تُفوتر", href: "/purchases/grni", icon: "Scale", capability: "erp.purchases.view", group: "التقارير" },
      { label: "تقرير الدفتر", href: "/purchases/reports/ledger", icon: "BookOpen", capability: "erp.purchases.view", group: "التقارير" },
      { label: "ترتيب الموردين", href: "/purchases/reports/suppliers", icon: "Users", capability: "erp.purchases.view", group: "التقارير" },
    ],
  },
  {
    heading: "المخزون",
    href: "/inventory",
    capability: "erp.inventory.view",
    moduleKey: "inventory",
    icon: "Warehouse",
    items: [
      { label: "الأصناف", href: "/inventory/items", icon: "Package", capability: "erp.inventory.view", group: "الأصناف والأرصدة" },
      { label: "المخازن", href: "/inventory/warehouses", icon: "Warehouse", capability: "erp.inventory.view", group: "الأصناف والأرصدة" },
      { label: "أرصدة المخزون", href: "/inventory/stock", icon: "Boxes", capability: "erp.inventory.view", group: "الأصناف والأرصدة" },
      { label: "دفتر حركة المخزون", href: "/inventory/ledger", icon: "ScrollText", capability: "erp.inventory.view", group: "الأصناف والأرصدة" },
      { label: "الأرقام التسلسلية", href: "/inventory/serials", icon: "ScanBarcode", capability: "erp.inventory.view", group: "الأصناف والأرصدة" },
      { label: "مواقع التخزين", href: "/inventory/bins", icon: "Grid3x3", capability: "erp.inventory.view", group: "الأصناف والأرصدة" },
      { label: "مطابقة قيمة المخزون", href: "/inventory/valuation", icon: "Scale", capability: "erp.inventory.view", group: "الأصناف والأرصدة" },

      { label: "إذون الاستلام", href: "/purchases/receipts", icon: "PackageCheck", capability: "erp.purchases.view", group: "العمليات" },
      { label: "إذون الصرف", href: "/sales/deliveries", icon: "Truck", capability: "erp.sales.view", group: "العمليات" },
      { label: "تسويات المخزون", href: "/inventory/adjustments", icon: "ClipboardCheck", capability: "erp.inventory.view", group: "العمليات" },
      { label: "الجرد الدوري", href: "/inventory/cycle-count", icon: "ListChecks", capability: "erp.inventory.view", group: "العمليات" },
      { label: "فحص الجودة", href: "/inventory/quality", icon: "ShieldCheck", capability: "erp.inventory.view", group: "العمليات" },
      { label: "التحويلات المخزنية", href: "/inventory/transfers", icon: "ArrowLeftRight", capability: "erp.inventory.view", group: "العمليات" },
      { label: "الحزم والمجموعات", href: "/inventory/bundles", icon: "Boxes", capability: "erp.inventory.view", group: "العمليات" },

      { label: "تدقيق مخزون FBA", href: "/inventory/reconciliation", icon: "ClipboardCheck", capability: "erp.inventory.view", group: "التنبيهات والأدوات" },
      { label: "تنبيهات إعادة الطلب", href: "/inventory/reorder", icon: "TriangleAlert", capability: "erp.inventory.view", group: "التنبيهات والأدوات" },
      { label: "المخزون الراكد", href: "/inventory/dead-stock", icon: "PackageX", capability: "erp.inventory.view", group: "التنبيهات والأدوات" },
      { label: "تنبيهات انتهاء الصلاحية", href: "/inventory/expiry", icon: "CalendarClock", capability: "erp.inventory.view", group: "التنبيهات والأدوات" },
      { label: "ملصقات الباركود", href: "/inventory/labels", icon: "Barcode", capability: "erp.inventory.view", group: "التنبيهات والأدوات" },
    ],
  },
  {
    heading: "المبيعات",
    href: "/sales",
    capability: "erp.sales.view",
    moduleKey: "sales",
    icon: "ShoppingCart",
    items: [
      // The customer master — same story as الموردون above.
      { label: "العملاء", href: "/sales/customers", icon: "Users", capability: "erp.sales.view", group: "البيانات الأساسية" },
      { label: "قوائم الأسعار", href: "/sales/price-lists", icon: "Tags", capability: "erp.sales.view", group: "البيانات الأساسية" },
      { label: "عمولات المبيعات", href: "/sales/commissions", icon: "Percent", capability: "erp.sales.view", group: "التقارير" },

      { label: "نقطة البيع", href: "/sales/pos", icon: "Store", capability: "erp.sales.create", group: "دورة البيع" },
      { label: "عروض الأسعار", href: "/sales/quotations", icon: "FileText", capability: "erp.sales.view", group: "دورة البيع" },
      { label: "أوامر البيع", href: "/sales/orders", icon: "ClipboardList", capability: "erp.sales.view", group: "دورة البيع" },
      { label: "فواتير البيع", href: "/sales/invoices", icon: "ReceiptText", capability: "erp.sales.view", group: "دورة البيع" },
      { label: "المرتجعات", href: "/sales/returns", icon: "Undo2", capability: "erp.sales.view", group: "دورة البيع" },
      { label: "مرتجعات المنصات", href: "/sales/marketplace-returns", icon: "PackageX", capability: "erp.sales.view", group: "دورة البيع" },
      { label: "أوامر السحب", href: "/sales/marketplace-removals", icon: "PackageX", capability: "erp.sales.view", group: "دورة البيع" },
      { label: "تعويضات المنصات", href: "/sales/marketplace-reimbursements", icon: "HandCoins", capability: "erp.accounting.view", group: "دورة البيع" },
      { label: "الفواتير الدورية", href: "/sales/recurring", icon: "Repeat", capability: "erp.sales.view", group: "دورة البيع" },

      { label: "تقرير الدفتر", href: "/sales/reports/ledger", icon: "BookOpen", capability: "erp.sales.view", group: "التقارير" },
      { label: "تقرير الأصناف", href: "/sales/reports/items", icon: "BarChart3", capability: "erp.sales.view", group: "التقارير" },
      { label: "ربحية المنتجات", href: "/sales/reports/profitability", icon: "TrendingUp", capability: "erp.reports.view", group: "التقارير" },
      { label: "ترتيب العملاء", href: "/sales/reports/customers", icon: "Users", capability: "erp.sales.view", group: "التقارير" },
    ],
  },
  {
    heading: "المستثمرون",
    href: "/investors",
    capability: "erp.investors.view",
    moduleKey: "investors",
    icon: "Coins",
    items: [
      { label: "المستثمرون", href: "/investors/list", icon: "Coins", capability: "erp.investors.view", group: "البيانات الأساسية" },

      { label: "مساهمات رأس المال", href: "/investors/investments", icon: "PiggyBank", capability: "erp.investors.view", group: "حقوق الملكية" },
      { label: "توزيعات الأرباح", href: "/investors/distributions", icon: "PieChart", capability: "erp.investors.view", group: "حقوق الملكية" },
      { label: "السحوبات", href: "/investors/withdrawals", icon: "Banknote", capability: "erp.investors.view", group: "حقوق الملكية" },
    ],
  },
  {
    heading: "الموارد البشرية",
    href: "/hr",
    capability: "erp.hr.view",
    moduleKey: "hr",
    icon: "UsersRound",
    items: [
      // The employee master. Like الموردون/العملاء, it had no entry — the heading
      // pointed straight at it, so the module had no landing page and /erp/hr 404'd.
      { label: "الموظفون",     href: "/hr/employees", icon: "UsersRound",  capability: "erp.hr.view", group: "البيانات الأساسية" },

      { label: "الإجازات",     href: "/hr/leaves",   icon: "CalendarDays",  capability: "erp.hr.view", group: "الحضور والإجازات" },
      { label: "الحضور والانصراف", href: "/hr/attendance", icon: "Clock", capability: "erp.hr.view", group: "الحضور والإجازات" },
      { label: "تقرير الإجازات", href: "/hr/leaves/report", icon: "BarChart3", capability: "erp.hr.view", group: "الحضور والإجازات" },
      { label: "تقويم العطلات", href: "/hr/holidays", icon: "CalendarOff",   capability: "erp.hr.view", group: "الحضور والإجازات" },

      { label: "مسير الرواتب", href: "/hr/payroll",   icon: "Banknote",      capability: "erp.hr.view", group: "المالية" },
      { label: "مطالبات المصروفات", href: "/hr/expense-claims", icon: "ReceiptText", capability: "erp.accounting.view", group: "المالية" },
    ],
  },
  {
    heading: "التقارير والتحليلات",
    href: "/reports/center",
    capability: "erp.reports.view",
    moduleKey: "reports",
    icon: "ChartColumn",
    items: [
      { label: "التقارير", href: "/reports/center", icon: "FileText", capability: "erp.reports.view", exact: true },
      { label: "التحليلات", href: "/reports/analytics", icon: "Activity", capability: "erp.reports.view" },
    ],
  },
  {
    heading: "الأدوات",
    icon: "Wrench",
    items: [
      { label: "الاستيراد والتصدير", href: "/imports", icon: "ArrowRightLeft", capability: "erp.sales.view" },
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
      { label: "الأكاديمية", href: "/academy", icon: "GraduationCap", capability: ACADEMY_CAPABILITY },
      { label: "آخر التحديثات", href: "/whats-new", icon: "Sparkles" },
      { label: "اقتراح أو شكوى", href: "/feedback", icon: "MessageSquarePlus" },
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
      { label: "الأرصدة الافتتاحية", href: "/settings/opening-balance", icon: "Upload", capability: "erp.accounting.create" },
      { label: "صلاحيات المستخدمين", href: "/settings/permissions", icon: "ShieldCheck", capability: "erp.settings.edit" },
      { label: "سجل التدقيق", href: "/audit", icon: "ScrollText", capability: "erp.settings.edit" },
      { label: "الإعدادات", href: "/settings", icon: "Settings", capability: "erp.settings.view" },
    ],
  },
];
