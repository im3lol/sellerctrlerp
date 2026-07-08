import Link from "next/link";
import { requireUser } from "@/lib/session";
import { getActiveOrg } from "@/lib/erp/org";
import { getEnabledModules } from "@/lib/erp/entitlements";
import { getErpOverview } from "@/lib/erp/overview";
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

const money = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const intl = (n: number) => n.toLocaleString("ar-EG-u-nu-latn");

export default async function DashboardPage() {
  const user = await requireUser();
  const { org } = await getActiveOrg();
  const enabled = user.role === "system_admin" || !org ? null : await getEnabledModules(org.id);
  const tiles = TILES.filter((t) => !enabled || enabled.has(t.module));
  const ov = org ? await getErpOverview(org.id) : null;

  const kpis = ov
    ? [
        { label: "صافي الربح", value: money(ov.net), href: "/erp/reports/income-statement", tone: ov.net >= 0 ? "text-emerald-600" : "text-destructive" },
        { label: "النقدية والبنك", value: money(ov.cash), href: "/erp/accounting/ledger", tone: "" },
        { label: "ذمم مدينة (عملاء)", value: money(ov.ar), href: "/erp/sales/aging", tone: "" },
        { label: "ذمم دائنة (موردون)", value: money(ov.ap), href: "/erp/purchases/aging", tone: "" },
        { label: "قيمة المخزون", value: money(ov.inventoryValue), href: "/erp/inventory/stock", tone: "" },
        { label: "مبيعات هذا الشهر", value: money(ov.salesMonth), href: "/erp/sales/invoices", tone: "" },
      ]
    : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">مرحباً، {user.name}</h1>
        <p className="text-muted-foreground">نظام {org?.nameAr ?? "الإدارة"} — نظرة عامة سريعة.</p>
      </div>

      {ov && (
        <>
          <div className="grid gap-4 grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            {kpis.map((k) => (
              <Link key={k.label} href={k.href}>
                <Card className="h-full transition-colors hover:border-primary/50">
                  <CardContent className="pt-6">
                    <div className="text-xs text-muted-foreground">{k.label}</div>
                    <div className={`mt-1 text-xl font-bold tabular-nums ${k.tone}`}>{k.value}</div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>

          {(ov.lowStock > 0 || ov.outOfStock > 0 || ov.overdueAR > 0 || ov.nearExpiryCount > 0) && (
            <div className="flex flex-wrap gap-2 text-sm">
              {ov.overdueAR > 0 && <Link href="/erp/sales/aging" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-1.5 text-destructive hover:bg-destructive/10">ذمم متأخرة: {money(ov.overdueAR)}</Link>}
              {ov.outOfStock > 0 && <Link href="/erp/inventory/reorder" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-1.5 text-destructive hover:bg-destructive/10">أصناف نافدة: {intl(ov.outOfStock)}</Link>}
              {ov.lowStock > 0 && <Link href="/erp/inventory/reorder" className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-1.5 text-amber-700 hover:bg-amber-500/10 dark:text-amber-400">مخزون منخفض: {intl(ov.lowStock)}</Link>}
              {ov.nearExpiryCount > 0 && <Link href="/erp/inventory/expiry" className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-1.5 text-amber-700 hover:bg-amber-500/10 dark:text-amber-400">قرب انتهاء الصلاحية: {intl(ov.nearExpiryCount)}</Link>}
            </div>
          )}
        </>
      )}

      <div>
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground">الوحدات</h2>
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
    </div>
  );
}
