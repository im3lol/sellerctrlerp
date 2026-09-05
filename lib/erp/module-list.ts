/** Module constants — no DB imports, safe to use in client components. */
export const ALL_MODULES = [
  "accounting", "inventory", "sales", "purchases", "investors", "reports", "hr", "marketplace",
  "maintenance",
] as const;

export type ModuleKey = (typeof ALL_MODULES)[number];

export const MODULE_LABELS: Record<string, string> = {
  accounting: "المحاسبة",
  inventory:  "المخزون",
  sales:      "المبيعات",
  purchases:  "المشتريات",
  investors:  "المستثمرون",
  reports:    "التقارير",
  hr:         "الموارد البشرية",
  marketplace:"المنصّات",
  maintenance:"الصيانة والأسطول",
};

/** Icon per module — mirrors the sidebar so the academy reads as the same product. */
export const MODULE_ICONS: Record<string, string> = {
  accounting: "Calculator",
  inventory:  "Warehouse",
  sales:      "ShoppingCart",
  purchases:  "Truck",
  investors:  "Coins",
  reports:    "BarChart3",
  hr:         "UsersRound",
  marketplace:"Store",
  maintenance:"Wrench",
};
