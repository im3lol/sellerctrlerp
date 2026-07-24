/**
 * Single source of truth for the settings area: feeds the persistent side nav
 * (settings layout) AND the /settings directory page. `capability` is an ERP org
 * permission ("module.action") checked against the member's permission set —
 * items without one are visible to any signed-in member (e.g. the personal
 * security page). `external` marks links that leave the settings shell.
 */

export type SettingsNavItem = {
  label: string;
  desc: string;
  href: string;
  icon: string;
  capability?: string;
  external?: boolean;
};

export type SettingsGroup = { heading: string; items: SettingsNavItem[] };

export const SETTINGS_GROUPS: SettingsGroup[] = [
  {
    heading: "المنشأة والاشتراك",
    items: [
      { label: "بيانات المنشأة", desc: "الاسم والشعار والعنوان والرقم الضريبي ونسبة الضريبة", href: "/settings/organization", icon: "Building2", capability: "settings.view" },
      { label: "الاشتراك والباقة", desc: "باقتك الحالية والوحدات المفعّلة والترقية", href: "/settings/subscription", icon: "CreditCard", capability: "settings.view" },
    ],
  },
  {
    heading: "المحاسبة والمالية",
    items: [
      { label: "الضبط المحاسبي", desc: "الحسابات الافتراضية التي تُرحَّل إليها المستندات تلقائياً", href: "/settings/accounting", icon: "Calculator", capability: "settings.view" },
      { label: "العملات وأسعار الصرف", desc: "العملات المفعّلة وتحديث أسعار الصرف اليومية", href: "/settings/currencies", icon: "BadgeDollarSign", capability: "settings.view" },
      { label: "الأرصدة الافتتاحية", desc: "أرصدة الحسابات والعملاء والموردين والمخزون في بداية النشاط", href: "/settings/opening-balance", icon: "Upload", capability: "accounting.create" },
      { label: "دليل الحسابات", desc: "شجرة الحسابات: إضافة وتعديل وتنظيم", href: "/accounting/chart", icon: "ListTree", capability: "accounting.view", external: true },
      { label: "الفترات المالية", desc: "فتح وإقفال الفترات المحاسبية", href: "/accounting/periods", icon: "Lock", capability: "accounting.view", external: true },
      { label: "مراكز التكلفة", desc: "توزيع الإيرادات والمصروفات على الفروع والأنشطة", href: "/accounting/cost-centers", icon: "Target", capability: "accounting.view", external: true },
    ],
  },
  {
    heading: "المستندات والطباعة",
    items: [
      { label: "ترقيم المستندات", desc: "بادئات أرقام الفواتير والسندات وباقي المستندات", href: "/settings/numbering", icon: "Hash", capability: "settings.view" },
      { label: "إعدادات الطباعة", desc: "ترويسة المطبوعات والأعمدة الظاهرة في كل وثيقة", href: "/settings/printing", icon: "Printer", capability: "settings.view" },
    ],
  },
  {
    heading: "المستخدمون والأمان",
    items: [
      { label: "صلاحيات المستخدمين", desc: "دعوة الأعضاء وتعيين أدوارهم داخل المؤسسة", href: "/settings/permissions", icon: "ShieldCheck", capability: "settings.view" },
      { label: "سجل التدقيق", desc: "من فعل ماذا ومتى — كل العمليات الحساسة", href: "/audit", icon: "ScrollText", capability: "settings.edit", external: true },
      { label: "الأمان وكلمة المرور", desc: "تغيير كلمة مرورك وتفعيل التحقق بخطوتين", href: "/settings/security", icon: "KeyRound" },
    ],
  },
  {
    heading: "البيانات والتكامل",
    items: [
      { label: "النسخ الاحتياطي", desc: "تحميل نسخة كاملة من بيانات مؤسستك والنسخ المحفوظة تلقائياً", href: "/settings/backup", icon: "DatabaseBackup", capability: "settings.edit" },
      { label: "مفاتيح الـ API", desc: "اربط أنظمتك الخارجية بالبيانات عبر REST API", href: "/settings/api-keys", icon: "Braces", capability: "settings.view" },
      { label: "إعداد الحساب", desc: "قائمة خطوات التجهيز الأولي للنظام", href: "/setup", icon: "Rocket", capability: "sales.view", external: true },
      { label: "المستودعات والأصناف", desc: "إدارة الأصناف والمخازن ووحدات القياس", href: "/inventory/items", icon: "Warehouse", capability: "inventory.view", external: true },
    ],
  },
];
