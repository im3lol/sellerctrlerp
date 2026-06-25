export type PortalNavItem = { label: string; href: string; icon: string; exact?: boolean };

export const PORTAL_NAV: { heading?: string; items: PortalNavItem[] }[] = [
  {
    items: [
      { label: "لوحة المتابعة", href: "/portal", icon: "LayoutDashboard", exact: true },
      { label: "المنتجات", href: "/portal/products", icon: "Package" },
    ],
  },
  {
    heading: "التقارير والإحصائيات",
    items: [
      { label: "تقارير وإحصائيات", href: "/portal/reports", icon: "BarChart3", exact: true },
      { label: "تقرير المخزون", href: "/portal/reports/inventory", icon: "Boxes" },
      { label: "تقرير المبيعات", href: "/portal/reports/sales", icon: "TrendingUp" },
      { label: "تقرير المرتجعات", href: "/portal/reports/returns", icon: "Undo2" },
    ],
  },
  {
    heading: "حسابي",
    items: [
      { label: "كشف حسابي", href: "/portal/erp", icon: "ReceiptText", exact: true },
    ],
  },
];
