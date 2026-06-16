import type { Capability } from "@/lib/rbac";

export type NavItem = {
  label: string;
  href: string;
  icon: string; // lucide icon name
  capability?: Capability; // if set, only shown when the user has it
  exact?: boolean;
};

export type NavSection = {
  heading?: string;
  items: NavItem[];
};

export const NAV: NavSection[] = [
  {
    items: [
      { label: "لوحة التحكم", href: "/dashboard", icon: "LayoutDashboard", exact: true },
      { label: "مساحات العمل", href: "/workspaces", icon: "Briefcase" },
      { label: "المنتجات", href: "/products", icon: "Package" },
      { label: "المهام", href: "/tasks/kanban", icon: "Columns3" },
      { label: "قائمة المهام", href: "/tasks", icon: "ListChecks" },
      { label: "المهام المتكررة", href: "/tasks/recurring", icon: "Repeat", capability: "task.manage" },
      { label: "الحضور", href: "/attendance", icon: "Clock" },
      { label: "الأكاديمية", href: "/academy", icon: "GraduationCap" },
    ],
  },
  {
    heading: "التحليلات",
    items: [
      { label: "المتصدرون", href: "/leaderboard", icon: "Trophy" },
      { label: "التقارير", href: "/reports", icon: "BarChart3", capability: "reports.view" },
      { label: "المساعد الذكي", href: "/assistant", icon: "Sparkles", capability: "ai.use" },
    ],
  },
  {
    heading: "الإدارة",
    items: [
      { label: "الموظفون", href: "/admin/users", icon: "Users", capability: "employee.manage" },
      { label: "العملاء", href: "/admin/clients", icon: "Store", capability: "client.manage" },
      // Google Sheets sync hidden for now (Excel import is used instead) — coming soon.
      // { label: "ربط Google Sheets", href: "/admin/sheets", icon: "Sheet", capability: "sheets.connect" },
      { label: "توزيع المنتجات", href: "/admin/distribution", icon: "Shuffle", capability: "product.distribute" },
      { label: "السحب الذكي", href: "/admin/scraping", icon: "Bot", capability: "product.review" },
      { label: "سجل التدقيق", href: "/admin/audit", icon: "ShieldCheck", capability: "role.manage" },
    ],
  },
];
