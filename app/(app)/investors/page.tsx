import Link from "next/link";
import { and, eq, sql } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { investors, investments, profitDistributions, withdrawals } from "@/db/schema";
import { orgOwnership } from "@/app/actions/erp/investor-equity";
import { accountBalances, naturalAmount } from "@/lib/erp/financials";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ErpPageHeader } from "@/components/erp/page-header";
import { AcademyLink } from "@/components/erp/academy-link";
import { NeedsAttention } from "@/components/erp/needs-attention";
import { Icon } from "@/components/icon";
import { cn } from "@/lib/utils";

const money = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const intf = (n: number) => n.toLocaleString("ar-EG-u-nu-latn");
const pct = (n: number) => `${n.toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 2 })}%`;
const cnt = (v: { n: number }[]) => Number(v[0]?.n ?? 0);

const SHORTCUTS = [
  { label: "المستثمرون", href: "/investors/list", icon: "Coins", key: "investors" },
  { label: "مساهمات رأس المال", href: "/investors/investments", icon: "PiggyBank", key: "investments" },
  { label: "توزيعات الأرباح", href: "/investors/distributions", icon: "PieChart", key: "distributions" },
  { label: "السحوبات", href: "/investors/withdrawals", icon: "Banknote" },
  { label: "دفتر الأستاذ", href: "/accounting/ledger", icon: "BookOpen" },
  { label: "الميزانية العمومية", href: "/reports/balance-sheet", icon: "Scale" },
];

/**
 * The المستثمرون module overview.
 *
 * The module used to be a 30-line contact list sitting on top of four tables no
 * code ever wrote to. These numbers come off the GL accounts the equity postings
 * now actually use, so this page and the balance sheet cannot disagree.
 */
export default async function InvestorsPage() {
  return loadErpPage("investors.view", async ({ orgId }) => {
    const [names, active, distDraft, investCount, profitPaid, owners, balances] = await Promise.all([
      db.select({ id: investors.id, name: investors.fullName, code: investors.code })
        .from(investors).where(eq(investors.organizationId, orgId)),
      db.select({ n: sql<number>`count(*)` }).from(investors)
        .where(and(eq(investors.organizationId, orgId), eq(investors.status, "active"))),
      db.select({ n: sql<number>`count(*)` }).from(profitDistributions)
        .where(and(eq(profitDistributions.organizationId, orgId), eq(profitDistributions.status, "DRAFT"))),
      db.select({ n: sql<number>`count(*)` }).from(investments).where(eq(investments.organizationId, orgId)),
      db.select({ v: sql<string>`coalesce(sum(${withdrawals.amount}), 0)` }).from(withdrawals)
        .where(and(eq(withdrawals.organizationId, orgId), eq(withdrawals.type, "profit"))),
      orgOwnership(orgId),
      accountBalances({ orgId }),
    ]);

    const nameOf = new Map(names.map((n) => [n.id, n.name || n.code]));
    const bal = (code: string) => balances.filter((b) => b.code === code).reduce((s, b) => s + naturalAmount(b), 0);
    const capital = bal("3102");     // رأس مال المستثمرين
    const distributed = bal("3103"); // أرباح موزّعة — contra-equity, so it reads negative
    const payable = bal("2104");     // declared, not yet paid out

    const todos = [
      { label: "توزيعات أرباح مسودة", hint: "بانتظار الترحيل", count: cnt(distDraft), href: "/investors/distributions", icon: "PieChart" },
    ];

    const counts: Record<string, number> = {
      investors: cnt(active), investments: cnt(investCount), distributions: cnt(distDraft),
    };

    const kpis = [
      { label: "رأس المال المستثمَر", value: capital, icon: "PiggyBank" },
      { label: "أرباح موزّعة", value: Math.abs(distributed), icon: "PieChart" },
      { label: "أرباح مستحقة لم تُصرف", value: payable, icon: "Banknote" },
      { label: "المستثمرون النشطون", value: cnt(active), icon: "Coins", int: true },
    ];

    return (
      <div className="space-y-6" dir="rtl">
        <ErpPageHeader icon="Coins" title="المستثمرون" subtitle="رأس المال، نسب الملكية، وتوزيعات الأرباح"
          action={<AcademyLink module="investors" />} />

        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
          {kpis.map((k) => (
            <Card key={k.label}>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div className="text-sm text-muted-foreground">{k.label}</div>
                  <Icon name={k.icon} className="size-4 text-muted-foreground" />
                </div>
                <div className="mt-1 text-2xl font-bold tabular-nums">{k.int ? intf(k.value) : money(k.value)}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        <NeedsAttention tiles={todos} />

        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>نسب الملكية</CardTitle>
              <CardDescription>محسوبة من صافي رأس المال لكل مستثمر (المساهمات − سحوبات رأس المال).</CardDescription>
            </CardHeader>
            <CardContent>
              {owners.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  لا يوجد رأس مال مستثمَر بعد — سجّل مساهمة من{" "}
                  <Link href="/investors/investments" className="text-primary underline">مساهمات رأس المال</Link>.
                </p>
              ) : (
                <div className="space-y-3">
                  {owners.map((o) => (
                    <div key={o.investorId} className="space-y-1">
                      <div className="flex justify-between text-sm">
                        <span>{nameOf.get(o.investorId) ?? o.investorId}</span>
                        <span className="tabular-nums text-muted-foreground">{pct(o.percent)}</span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-muted">
                        <div className="h-2 rounded-full bg-primary" style={{ width: `${Math.max(o.percent, 2)}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="flex flex-col justify-center">
            <CardContent className="space-y-4 py-8 text-center">
              <div className="text-sm text-muted-foreground">رأس المال المستثمَر</div>
              <div className="text-4xl font-bold tabular-nums">{money(capital)}</div>
              <div className="flex justify-center gap-6 pt-2 text-sm">
                <div>
                  <div className="text-muted-foreground">مستحق لم يُصرف</div>
                  <div className={cn("font-semibold tabular-nums", payable > 0 && "text-amber-600")}>{money(payable)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">أرباح مصروفة</div>
                  <div className="font-semibold tabular-nums">{money(Number(profitPaid[0]?.v ?? 0))}</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader><CardTitle>اختصارات</CardTitle></CardHeader>
          <CardContent>
            <div className="grid gap-3 grid-cols-2 md:grid-cols-3">
              {SHORTCUTS.map((s) => (
                <Link key={s.href} href={s.href}
                  className="flex items-center gap-3 rounded-lg border border-border p-3 text-sm transition-colors hover:bg-muted">
                  <Icon name={s.icon} className="size-4 text-muted-foreground" />
                  <span className="flex-1">{s.label}</span>
                  {s.key && counts[s.key] > 0 && (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground">{intf(counts[s.key])}</span>
                  )}
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  });
}
