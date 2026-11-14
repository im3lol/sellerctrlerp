import type { NavItem } from "@/components/app-shell/nav-config";

export type NavPlatform = { id: string; name: string; code: string; integrationType?: string | null; isActive?: boolean };

/** Inactive platforms with saved offers expose monitoring only, without enabling sync. */
export function platformNavItems(p: NavPlatform): NavItem[] {
  const code = p.code.toLowerCase();
  const href = `/platforms/${code}`;
  const amazon = p.integrationType ? p.integrationType === "amazon" : code === "amazon";
  if (p.isActive === false) {
    return amazon ? [{ label: "مراقبة Buy Box", href: `${href}/buy-box`, icon: "Trophy", capability: "erp.sales.view" }] : [];
  }
  if (!amazon) {
    return [{ label: p.name, href, icon: "Store", capability: "erp.sales.view" }];
  }
  return [
    { label: "لوحة أمازون", href, icon: "Store", capability: "erp.sales.view", group: "أدوات أمازون" },
    { label: "صحة أمازون", href: `${href}/health`, icon: "HeartPulse", capability: "erp.sales.view", group: "أدوات أمازون" },
    { label: "مراقبة Buy Box", href: `${href}/buy-box`, icon: "Trophy", capability: "erp.sales.view", group: "أدوات أمازون" },
    { label: "خطة FBA", href: `${href}/fba-plan`, icon: "Boxes", capability: "erp.inventory.view", group: "أدوات أمازون" },
    { label: "مزامنة أمازون", href: `${href}/import`, icon: "RefreshCw", capability: "erp.sales.view", group: "المزامنة والتسويات" },
    { label: "دفعات أمازون", href: `${href}/payouts`, icon: "Landmark", capability: "erp.accounting.create", group: "المزامنة والتسويات" },
    { label: "رسوم أمازون", href: `${href}/fees`, icon: "ReceiptText", capability: "erp.accounting.view", group: "المزامنة والتسويات" },
    { label: "كشف أمازون", href: `${href}/statements`, icon: "FileText", capability: "erp.accounting.view", group: "المزامنة والتسويات" },
    { label: "فحص المزامنة", href: `${href}/verify`, icon: "ShieldCheck", capability: "erp.sales.view", group: "المزامنة والتسويات" },
  ];

}
