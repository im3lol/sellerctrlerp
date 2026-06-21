import type { Capability } from "@/lib/rbac";

export type NavItem = {
  label: string;
  href: string;
  icon: string; // lucide icon name
  capability?: Capability; // if set, only shown when the user has it
  exact?: boolean;
};

export type NavSection = {
  heading?: string; // module name. When set, the group is collapsible.
  headingHref?: string; // when set, clicking the heading navigates here (module landing/dashboard)
  icon?: string; // module (lucide) icon shown next to the heading
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
    heading: "المحاسبة",
    headingHref: "/erp/accounting",
    icon: "Calculator",
    items: [
      { label: "نظرة عامة", href: "/erp/accounting", icon: "LayoutDashboard", capability: "erp.accounting.view", exact: true },
      { label: "دليل الحسابات", href: "/erp/accounting/chart", icon: "Calculator", capability: "erp.accounting.view" },
      { label: "القيود اليومية", href: "/erp/accounting/journal", icon: "BookText", capability: "erp.accounting.view" },
      { label: "دفتر الأستاذ", href: "/erp/accounting/ledger", icon: "BookOpen", capability: "erp.accounting.view" },
      { label: "مراكز التكلفة", href: "/erp/accounting/cost-centers", icon: "Target", capability: "erp.accounting.view" },
      { label: "الفترات المالية", href: "/erp/accounting/periods", icon: "Lock", capability: "erp.accounting.view" },
    ],
  },
  {
    heading: "المشتريات",
    icon: "Truck",
    items: [
      { label: "الموردون", href: "/erp/purchases", icon: "Users", capability: "erp.purchases.view", exact: true },
      { label: "أوامر الشراء", href: "/erp/purchases/orders", icon: "ClipboardList", capability: "erp.purchases.view" },
      { label: "فواتير الشراء", href: "/erp/purchases/invoices", icon: "ReceiptText", capability: "erp.purchases.view" },
      { label: "سندات الصرف", href: "/erp/purchases/payments", icon: "Banknote", capability: "erp.purchases.view" },
      { label: "مرتجعات المشتريات", href: "/erp/purchases/returns", icon: "Undo2", capability: "erp.purchases.view" },
      { label: "أعمار الذمم الدائنة", href: "/erp/purchases/aging", icon: "CalendarClock", capability: "erp.purchases.view" },
    ],
  },
  {
    heading: "المخزون",
    icon: "Warehouse",
    headingHref: "/erp/inventory",
    items: [
      { label: "نظرة عامة", href: "/erp/inventory", icon: "LayoutDashboard", capability: "erp.inventory.view", exact: true },
      { label: "الأصناف", href: "/erp/inventory/items", icon: "Package", capability: "erp.inventory.view" },
      { label: "إذون الاستلام", href: "/erp/purchases/receipts", icon: "PackageCheck", capability: "erp.purchases.view" },
      { label: "إذون الصرف", href: "/erp/sales/deliveries", icon: "Truck", capability: "erp.sales.view" },
      { label: "أرصدة المخزون", href: "/erp/inventory/stock", icon: "Boxes", capability: "erp.inventory.view" },
      { label: "دفتر حركة المخزون", href: "/erp/inventory/ledger", icon: "ScrollText", capability: "erp.inventory.view" },
      { label: "تسويات المخزون", href: "/erp/inventory/adjustments", icon: "ClipboardCheck", capability: "erp.inventory.view" },
      { label: "التحويلات المخزنية", href: "/erp/inventory/transfers", icon: "ArrowLeftRight", capability: "erp.inventory.view" },
      { label: "تنبيهات إعادة الطلب", href: "/erp/inventory/reorder", icon: "TriangleAlert", capability: "erp.inventory.view" },
    ],
  },
  {
    heading: "المبيعات",
    icon: "ShoppingCart",
    items: [
      { label: "العملاء", href: "/erp/sales", icon: "Users", capability: "erp.sales.view", exact: true },
      { label: "أوامر البيع", href: "/erp/sales/orders", icon: "ClipboardList", capability: "erp.sales.view" },
      { label: "فواتير البيع", href: "/erp/sales/invoices", icon: "ReceiptText", capability: "erp.sales.view" },
      { label: "سندات القبض", href: "/erp/sales/receipts", icon: "HandCoins", capability: "erp.sales.view" },
      { label: "مرتجعات المبيعات", href: "/erp/sales/returns", icon: "Undo2", capability: "erp.sales.view" },
      { label: "أعمار الذمم المدينة", href: "/erp/sales/aging", icon: "CalendarClock", capability: "erp.sales.view" },
    ],
  },
  {
    heading: "إدارة العملاء (CRM)",
    icon: "Headset",
    items: [
      { label: "مساحات العمل", href: "/workspaces", icon: "Briefcase" },
      { label: "منتجات العملاء", href: "/products", icon: "Package" },
      { label: "المهام", href: "/tasks/kanban", icon: "Columns3" },
      { label: "قائمة المهام", href: "/tasks", icon: "ListChecks" },
      { label: "المهام المتكررة", href: "/tasks/recurring", icon: "Repeat", capability: "task.manage" },
      { label: "توزيع المنتجات", href: "/admin/distribution", icon: "Shuffle", capability: "product.distribute" },
      { label: "السحب الذكي", href: "/admin/scraping", icon: "Bot", capability: "product.review" },
    ],
  },
  {
    heading: "المستثمرون",
    icon: "Coins",
    items: [
      { label: "نظرة عامة", href: "/erp/investors", icon: "Coins", capability: "erp.investors.view" },
    ],
  },
  {
    heading: "الموارد البشرية",
    icon: "UsersRound",
    items: [
      { label: "الحضور", href: "/attendance", icon: "Clock" },
      { label: "المتصدرون", href: "/leaderboard", icon: "Trophy" },
      { label: "الأكاديمية", href: "/academy", icon: "GraduationCap" },
    ],
  },
  {
    heading: "التقارير والتحليلات",
    icon: "ChartColumn",
    items: [
      { label: "ميزان المراجعة", href: "/erp/reports", icon: "ChartPie", capability: "erp.reports.view", exact: true },
      { label: "قائمة الدخل", href: "/erp/reports/income-statement", icon: "TrendingUp", capability: "erp.reports.view" },
      { label: "الميزانية العمومية", href: "/erp/reports/balance-sheet", icon: "Scale", capability: "erp.reports.view" },
      { label: "تقارير العمليات", href: "/reports", icon: "BarChart3", capability: "reports.view" },
      { label: "متابعة الأداء", href: "/admin/monitoring", icon: "Activity", capability: "reports.view" },
      { label: "المساعد الذكي", href: "/assistant", icon: "Sparkles", capability: "ai.use" },
    ],
  },
  {
    heading: "الإدارة والإعدادات",
    icon: "ShieldCheck",
    items: [
      { label: "الموظفون", href: "/admin/users", icon: "Users", capability: "employee.manage" },
      { label: "العملاء", href: "/admin/clients", icon: "Store", capability: "client.manage" },
      { label: "سجل التدقيق", href: "/admin/audit", icon: "ShieldCheck", capability: "role.manage" },
      { label: "سجل تدقيق ERP", href: "/erp/audit", icon: "ScrollText", capability: "erp.settings.manage" },
      { label: "إعدادات ERP", href: "/erp/settings", icon: "Settings", capability: "erp.settings.manage" },
    ],
  },
];
