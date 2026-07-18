// Single source of truth for admin navigation — consumed by both the sidebar and the
// home section cards, so they can't drift apart (they used to: home omitted several).
export type AdminNavItem = { label: string; href: string; icon: string; desc: string; exact?: boolean };
export const ADMIN_NAV: readonly AdminNavItem[] = [
  { label: "نظرة عامة", href: "/admin", icon: "LayoutDashboard", exact: true, desc: "أداء المنصّة: الإيراد والاشتراكات والتجديدات." },
  { label: "التحليلات", href: "/admin/analytics", icon: "ChartLine", desc: "التحويل والاحتفاظ وقيمة العميل (LTV/ARPU/churn)." },
  { label: "الباقات", href: "/admin/plans", icon: "Package", desc: "خطط الاشتراك: الوحدات والحدود والأسعار." },
  { label: "المؤسسات والاشتراكات", href: "/admin/licensing", icon: "Building2", desc: "الاشتراكات، الاستهلاك، طلبات التفعيل." },
  { label: "التحصيلات", href: "/admin/collections", icon: "Wallet", desc: "تسجيل مدفوعات المؤسسات مقابل الاشتراك." },
  { label: "كوبونات الخصم", href: "/admin/coupons", icon: "Ticket", desc: "أكواد خصم تُطبَّق على سعر الاشتراك." },
  { label: "سجل النشاط", href: "/admin/activity", icon: "History", desc: "دخول الدعم والتحصيلات وتغييرات الاشتراكات." },
  { label: "الأكاديمية", href: "/admin/academy", icon: "GraduationCap", desc: "محتوى التدريب والشرح للمنتج." },
  { label: "آخر التحديثات", href: "/admin/changelog", icon: "Sparkles", desc: "ملاحظات الإصدارات المعروضة للعملاء." },
  { label: "الاقتراحات والشكاوى", href: "/admin/feedback", icon: "MessageSquarePlus", desc: "صندوق ملاحظات المؤسسات عبر النظام." },
  { label: "أدوات النظام", href: "/admin/system", icon: "Server", desc: "حالة الخادم وقاعدة البيانات والتخزين." },
];
