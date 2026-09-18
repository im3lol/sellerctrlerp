import Link from "next/link";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { salesPlatforms, inventoryAudits } from "@/db/schema";
import { loadErpPage } from "@/lib/erp/org";
import { getFbaPlanInputs, getFbaSources } from "@/lib/erp/fba-plan-data";
import { planFbaShipment } from "@/lib/erp/fba-plan";
import { ErpPageHeader } from "@/components/erp/page-header";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const int = (n: number) => n.toLocaleString("ar-EG-u-nu-latn");

type Check = { icon: string; title: string; count: number; ok: string; bad: string; href: string; action: string; tone?: "warn" };

/**
 * One page that answers "is my Amazon side OK today?" — every check that used to live on
 * its own screen, as a count with the link that fixes it. Read-only.
 */
export default async function AmazonHealthPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const back = `/platforms/${code.toLowerCase()}`;

  return loadErpPage("sales.view", async ({ orgId, can }) => {
    // Marketplace health is useful to sales users too, but FBA balances/audits are
    // inventory data and must never be disclosed without inventory.view.
    const canViewInventory = can("inventory.view");
    const [platform] = await db.select({ name: salesPlatforms.name, integrationType: salesPlatforms.integrationType, fbaWarehouseId: salesPlatforms.defaultWarehouseId })
      .from(salesPlatforms)
      .where(and(eq(salesPlatforms.organizationId, orgId), eq(salesPlatforms.code, code.toUpperCase())))
      .limit(1);
    const header = (
      <ErpPageHeader icon="HeartPulse" title="صحة أمازون" backHref={platform ? back : "/platforms"}
        subtitle="كل اللي محتاج منك حاجة في أمازون النهارده — في صفحة واحدة" />
    );
    if (platform?.integrationType !== "amazon") {
      return (
        <div className="space-y-6">{header}
          <div className="space-y-3 rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
            <p>الصفحة دي لمنصة أمازون — اربط حسابك الأول من صفحة المنصات.</p>
            <Button asChild size="sm"><Link href="/platforms">اربط أمازون</Link></Button>
          </div>
        </div>
      );
    }

    const n = (q: Promise<{ rows: { n: number }[] }>) => q.then((r) => Number(r.rows[0]?.n ?? 0));
    const [unmatched, failedSyncs, unposted, returns, reimbursements, lostBuyBox, [audit], fbaNeeds] = await Promise.all([
      n(db.execute(sql`SELECT count(*)::int n FROM unmatched_orders WHERE organization_id = ${orgId} AND channel = 'AMAZON' AND status = 'PENDING'`)),
      // Sync kinds whose LATEST run failed — a failure the next run already recovered from isn't news.
      n(db.execute(sql`SELECT count(*)::int n FROM (
        SELECT DISTINCT ON (kind) status FROM sync_runs
        WHERE organization_id = ${orgId} AND provider = 'amazon' AND status <> 'RUNNING' AND started_at > now() - interval '7 days'
        ORDER BY kind, started_at DESC) s WHERE status = 'FAILED'`)),
      n(db.execute(sql`SELECT count(*)::int n FROM marketplace_settlement_txns WHERE organization_id = ${orgId} AND channel = 'AMAZON' AND status = 'Released' AND journal_entry_id IS NULL`)),
      n(db.execute(sql`SELECT count(*)::int n FROM sales_returns WHERE organization_id = ${orgId} AND status = 'DRAFT' AND channel = 'AMAZON'`)),
      n(db.execute(sql`SELECT count(*)::int n FROM fba_reimbursements WHERE organization_id = ${orgId} AND status = 'PENDING'`)),
      n(db.execute(sql`SELECT count(*)::int n FROM platform_offers WHERE organization_id = ${orgId} AND channel = 'AMAZON' AND is_winner = false`)),
      canViewInventory ? db.select({ withDiff: inventoryAudits.withDiff, lost: inventoryAudits.lost, damaged: inventoryAudits.damaged, at: inventoryAudits.createdAt })
        .from(inventoryAudits)
        .where(and(eq(inventoryAudits.organizationId, orgId), eq(inventoryAudits.provider, "amazon"), eq(inventoryAudits.status, "OK")))
        .orderBy(desc(inventoryAudits.createdAt)).limit(1) : Promise.resolve([]),
      canViewInventory ? (async () => {
        const [source] = await getFbaSources(orgId);
        if (!platform.fbaWarehouseId || !source) return 0;
        const { rows } = await getFbaPlanInputs(orgId, platform.fbaWarehouseId, source.id, 30);
        return planFbaShipment(rows, { windowDays: 30, transitDays: 14, coverDays: 30 })
          .filter((r) => r.status === "out" || r.status === "critical").length;
      })() : Promise.resolve(0),
    ]);

    const checks: Check[] = [
      { icon: "PackageX", title: "طلبات بمنتج مش معروف", count: unmatched, ok: "كل طلبات أمازون متربطة بأصنافها", bad: "طلبات مستنية تربط الـSKU بصنف عشان تتسجّل", href: "/sales/orders/unmatched", action: "اربط الأصناف" },
      { icon: "RefreshCwOff", title: "مزامنات واقفة", count: failedSyncs, ok: "كل أنواع المزامنة آخر مرة نجحت", bad: "نوع مزامنة آخر محاولة ليه فشلت — افتح صفحة المنصة وشوف السبب", href: back, action: "صفحة أمازون" },
      { icon: "FileClock", title: "حركات تسوية مش مترحّلة", count: unposted, ok: "كل التسويات المفرج عنها مترحّلة للحسابات", bad: "حركات من كشف أمازون لسه ماتسجّلتش في الحسابات", href: `${back}/statements`, action: "كشف أمازون" },
      ...(canViewInventory ? [{ icon: "Truck", title: "أصناف محتاجة شحن لأمازون", count: fbaNeeds, ok: "المخزون عند أمازون مكفّي", bad: "أصناف خلصت أو هتخلص قبل ما شحنة توصل", href: `${back}/fba-plan`, action: "خطة الشحن" }] : []),
      { icon: "Trophy", title: "خسرت الـBuy Box", count: lostBuyBox, ok: "كسبان الـBuy Box على كل اللي بتراقبه", bad: "بائع تاني واخد الـBuy Box — راجع السعر", href: `${back}/buy-box`, action: "مراقبة Buy Box", tone: "warn" },
      { icon: "Undo2", title: "مرتجعات مستنية قرارك", count: returns, ok: "مفيش مرتجعات معلّقة", bad: "مرتجعات أمازون مستنية تقرر استلمتها ولا لأ", href: "/sales/marketplace-returns", action: "المرتجعات" },
      { icon: "HandCoins", title: "تعويضات مستنية تسجيل", count: reimbursements, ok: "كل تعويضات أمازون متسجّلة", bad: "تعويضات من أمازون لسه ماتسجّلتش", href: "/sales/marketplace-reimbursements", action: "التعويضات", tone: "warn" },
      ...(canViewInventory ? [audit
        ? { icon: "ClipboardCheck", title: "فروق مخزون FBA (آخر تدقيق)", count: audit.withDiff, ok: "مخزون أمازون مطابق للنظام", bad: `فرق بين أمازون والنظام${audit.lost + audit.damaged > 0 ? ` — منها ${int(audit.lost + audit.damaged)} مفقود/تالف` : ""}`, href: "/inventory/reconciliation", action: "المطابقة" }
        : { icon: "ClipboardCheck", title: "تدقيق مخزون FBA", count: 1, ok: "", bad: "ماعملتش تدقيق لسه — شغّله من صفحة أمازون", href: back, action: "تدقيق المخزون" }] : []),
    ];
    const open = checks.filter((c) => c.count > 0).length;

    return (
      <div className="space-y-6">
        {header}
        <div className={cn("flex items-center gap-3 rounded-2xl border p-4 text-sm font-medium",
          open === 0 ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300" : "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300")}>
          <Icon name={open === 0 ? "CircleCheck" : "TriangleAlert"} className="size-5 shrink-0" />
          {open === 0 ? "كله تمام — مفيش حاجة مستنياك في أمازون." : `${int(open)} من ${int(checks.length)} محتاجين منك حاجة.`}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {checks.map((c) => {
            const bad = c.count > 0;
            return (
              <Link key={c.title} href={c.href}
                className={cn("group flex flex-col gap-2 rounded-2xl border bg-card p-4 transition-colors hover:border-primary/40",
                  bad && (c.tone === "warn" ? "border-amber-500/40" : "border-destructive/40"))}>
                <div className="flex items-center gap-2">
                  <Icon name={c.icon} className="size-4 text-muted-foreground" />
                  <span className="font-semibold">{c.title}</span>
                  <span className={cn("ms-auto text-2xl font-bold tabular-nums",
                    !bad ? "text-emerald-600" : c.tone === "warn" ? "text-amber-600" : "text-destructive")}>
                    {bad ? int(c.count) : <Icon name="CircleCheck" className="size-6" />}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">{bad ? c.bad : c.ok}</p>
                <span className="mt-auto text-sm text-primary group-hover:underline">{c.action} ←</span>
              </Link>
            );
          })}
        </div>
      </div>
    );
  }, "marketplace");
}
