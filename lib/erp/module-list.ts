/** Module constants — no DB imports, safe to use in client components. */
export const ALL_MODULES = [
  "accounting", "inventory", "sales", "purchases", "investors", "reports", "hr",
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
};
