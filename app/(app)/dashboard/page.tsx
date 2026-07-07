import Link from "next/link";
import { requireUser } from "@/lib/session";
import { getActiveOrg } from "@/lib/erp/org";
import { getEnabledModules } from "@/lib/erp/entitlements";
import { Card, CardContent } from "@/components/ui/card";
import { Icon } from "@/components/icon";

const TILES: { label: string; href: string; icon: string; module: string; desc: string }[] = [
  { label: "المحاسبة", href: "/erp/accounting", icon: "Calculator", module: "accounting", desc: "دليل الحسابات، القيود، التقارير المالية" },
  { label: "المبيعات", href: "/erp/sales/orders", icon: "ShoppingCart", module: "sales", desc: "العملاء، أوامر البيع، الفواتير، أمازون" },
  { label: "المشتريات", href: "/erp/purchases", icon: "Truck", module: "purchases", desc: "الموردون، أوامر الشراء، الفواتير" },
  { label: "المخزون", href: "/erp/inventory/items", icon: "Boxes", module: "inventory", desc: "الأصناف، الأرصدة، الحركة، التسويات" },
  { label: "الموارد البشرية", href: "/erp/hr/employees", icon: "UserCog", module: "hr", desc: "الموظفون ومسير الرواتب" },
  { label: "المستثمرون", href: "/erp/investors", icon: "Coins", module: "investors", desc: "المستثمرون وحصصهم" },
  { label: "التقارير", href: "/erp/reports", icon: "ChartPie", module: "reports", desc: "ميزان المراجعة، الدخل، الميزانية، الضريبة" },
];

export default async function DashboardPage() {
  const user = await requireUser();
  const { org } = await getActiveOrg();
  const enabled = user.role === "system_admin" || !org ? null : await getEnabledModules(org.id);
  const tiles = TILES.filter((t) => !enabled || enabled.has(t.module));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">مرحباً، {user.name}</h1>
        <p className="text-muted-foreground">نظام {org?.nameAr ?? "الإدارة"} — اختر وحدة للبدء.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tiles.map((t) => (
          <Link key={t.href} href={t.href}>
            <Card className="h-full transition-colors hover:border-primary/50 hover:bg-accent/40">
              <CardContent className="flex items-start gap-4 p-5">
                <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                  <Icon name={t.icon} className="size-5" />
                </div>
                <div className="min-w-0">
                  <div className="font-semibold">{t.label}</div>
                  <div className="text-sm text-muted-foreground">{t.desc}</div>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
