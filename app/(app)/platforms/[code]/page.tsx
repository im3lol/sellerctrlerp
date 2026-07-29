import { notFound } from "next/navigation";
import Link from "next/link";
import { and, desc, eq, gte, or, sql } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { salesPlatforms, salesOrders, salesOrderLines, salesReturns, receiptVouchers, customers, warehouses, bankAccounts, items, inventoryAudits, inventoryAuditLines } from "@/db/schema";
import { AuditStats } from "@/components/erp/audit-summary";
import { getPlatformPnl } from "@/lib/erp/platform-pnl";
import { Field } from "@/components/erp/document-detail";
import { ErpPageHeader } from "@/components/erp/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PlatformHeaderActions } from "@/components/erp/platform-header-actions";
import { MarketplaceConnect } from "@/components/erp/marketplace-connect";
import { TrendChart } from "@/components/charts/trend-chart";
import { StatusDonut } from "@/components/charts/status-donut";
import { getConnector } from "@/lib/erp/marketplace/registry";
import { getConnection } from "@/lib/erp/marketplace/connection";

// Marketplace sync (server actions on this route) polls Amazon's async reports —
// allow a longer function budget on Vercel (needs a Pro/Fluid plan for >60s).
export const maxDuration = 300;

const fmt = (n: number | string | null) => Number(n ?? 0).toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const int = (n: number | string | null) => Number(n ?? 0).toLocaleString("ar-EG-u-nu-latn");
const dt = (d: Date) => new Date(d).toLocaleDateString("en-GB", { year: "numeric", month: "2-digit", day: "2-digit" });
// Fixed categorical colors (dataviz reference palette, validated order) — labels + hue per status.
const STATUS: Record<string, { label: string; color: string }> = {
  DRAFT: { label: "مسودة", color: "#2a78d6" },
  CONFIRMED: { label: "مؤكّد", color: "#1baf7a" },
  PARTIALLY_DELIVERED: { label: "تسليم جزئي", color: "#eda100" },
  DELIVERED: { label: "مُسلّم", color: "#008300" },
  INVOICED: { label: "مفوتر", color: "#4a3aa7" },
  CANCELLED: { label: "ملغى", color: "#e34948" },
};

function Kpi({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "danger" | "ok" }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-sm text-muted-foreground">{label}</div>
        <div className={`text-2xl font-bold tabular-nums ${tone === "danger" ? "text-destructive" : tone === "ok" ? "text-emerald-600" : ""}`}>{value}</div>
        {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
}

export default async function PlatformDetailPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ connected?: string; err?: string }> }) {
  const { code: codeParam } = await params;
  const { connected, err } = await searchParams;
  return loadErpPage("sales.view", async ({ orgId, can }) => {
    const [platform] = await db
      .select({
        id: salesPlatforms.id, name: salesPlatforms.name, code: salesPlatforms.code,
        integrationType: salesPlatforms.integrationType, isActive: salesPlatforms.isActive,
        syncProducts: salesPlatforms.syncProducts, syncOrders: salesPlatforms.syncOrders, syncInventory: salesPlatforms.syncInventory,
        defaultWarehouseId: salesPlatforms.defaultWarehouseId,
        customerId: salesPlatforms.customerId, customerName: customers.nameAr, customerBalance: customers.balance,
        warehouseName: warehouses.nameAr, bankName: bankAccounts.nameAr,
      })
      .from(salesPlatforms)
      .leftJoin(customers, eq(customers.id, salesPlatforms.customerId))
      .leftJoin(warehouses, eq(warehouses.id, salesPlatforms.defaultWarehouseId))
      .leftJoin(bankAccounts, eq(bankAccounts.id, salesPlatforms.bankAccountId))
      .where(and(eq(salesPlatforms.code, codeParam.toUpperCase()), eq(salesPlatforms.organizationId, orgId)))
      .limit(1);
    if (!platform) notFound();

    const isAmazon = platform.integrationType === "amazon";
    const match = or(eq(salesOrders.platformId, platform.id), eq(salesOrders.channel, platform.code));
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
    const custId = platform.customerId;
    const pnl = can("reports.view") ? await getPlatformPnl(orgId, platform.code, custId) : null;

    // Analytics are best-effort: a slow/failed query (e.g. DB connection pressure on
    // serverless) degrades this section instead of crashing the whole page. Split
    // into small batches to keep the concurrent-connection burst low.
    let ordersCount = 0, salesTotal = 0, monthN = 0, monthTotal = 0, retN = 0, retTotal = 0, collTotal = 0;
    let productCount = 0, invQty = 0;
    let salesSeries: { label: string; value: number }[] = [];
    let statusRows: { status: string; n: number }[] = [];
    let topItems: { name: string | null; code: string; qty: string; total: string }[] = [];
    let recent: { number: string; date: Date; status: string; ext: string | null; total: string }[] = [];
    let analyticsFailed = false;
    try {
      const [[all], [month], statusR] = await Promise.all([
        db.select({ n: sql<number>`count(*)`, total: sql<string>`coalesce(sum(${salesOrders.totalAmount}),0)` }).from(salesOrders).where(and(eq(salesOrders.organizationId, orgId), match)),
        db.select({ n: sql<number>`count(*)`, total: sql<string>`coalesce(sum(${salesOrders.totalAmount}),0)` }).from(salesOrders).where(and(eq(salesOrders.organizationId, orgId), match, gte(salesOrders.date, monthStart))),
        db.select({ status: salesOrders.status, n: sql<number>`count(*)` }).from(salesOrders).where(and(eq(salesOrders.organizationId, orgId), match)).groupBy(salesOrders.status),
      ]);
      ordersCount = Number(all?.n ?? 0); salesTotal = Number(all?.total ?? 0);
      monthN = Number(month?.n ?? 0); monthTotal = Number(month?.total ?? 0);
      statusRows = statusR;

      const [top, rec, [ret], [coll]] = await Promise.all([
        db.select({ name: items.nameAr, code: items.code, qty: sql<string>`sum(${salesOrderLines.quantity})`, total: sql<string>`sum(${salesOrderLines.totalAmount})` })
          .from(salesOrderLines).innerJoin(salesOrders, eq(salesOrders.id, salesOrderLines.salesOrderId)).innerJoin(items, eq(items.id, salesOrderLines.itemId))
          .where(and(eq(salesOrders.organizationId, orgId), match)).groupBy(items.id).orderBy(desc(sql`sum(${salesOrderLines.totalAmount})`)).limit(5),
        db.select({ number: salesOrders.number, date: salesOrders.date, status: salesOrders.status, ext: salesOrders.externalOrderId, total: salesOrders.totalAmount })
          .from(salesOrders).where(and(eq(salesOrders.organizationId, orgId), match)).orderBy(desc(salesOrders.date), desc(salesOrders.number)).limit(8),
        custId
          ? db.select({ n: sql<number>`count(*)`, total: sql<string>`coalesce(sum(${salesReturns.totalAmount}),0)` }).from(salesReturns).where(and(eq(salesReturns.organizationId, orgId), eq(salesReturns.customerId, custId)))
          : Promise.resolve([{ n: 0, total: "0" }]),
        custId
          ? db.select({ total: sql<string>`coalesce(sum(${receiptVouchers.amount}),0)` }).from(receiptVouchers).where(and(eq(receiptVouchers.organizationId, orgId), eq(receiptVouchers.customerId, custId), eq(receiptVouchers.status, "POSTED")))
          : Promise.resolve([{ total: "0" }]),
      ]);
      topItems = top; recent = rec;
      retN = Number(ret?.n ?? 0); retTotal = Number(ret?.total ?? 0); collTotal = Number(coll?.total ?? 0);

      // Catalog size, on-hand for the platform's warehouse, and a 30-day sales trend.
      const whId = platform.defaultWarehouseId;
      const since = new Date(Date.now() - 30 * 864e5);
      const [[pc], invRes, trendR] = await Promise.all([
        db.select({ n: sql<number>`count(*)` }).from(items).where(and(eq(items.organizationId, orgId), eq(items.isActive, true))),
        db.execute<{ q: string }>(sql`
          SELECT COALESCE(SUM(bq), 0) AS q FROM (
            SELECT DISTINCT ON (item_id, warehouse_id) balance_quantity AS bq
            FROM stock_movements
            WHERE organization_id = ${orgId} ${whId ? sql`AND warehouse_id = ${whId}` : sql``}
            ORDER BY item_id, warehouse_id, created_at DESC, split_part(number, '-', 3)::int DESC
          ) t`),
        db.select({ d: sql<string>`to_char(${salesOrders.date}, 'YYYY-MM-DD')`, t: sql<string>`coalesce(sum(${salesOrders.totalAmount}),0)` })
          .from(salesOrders).where(and(eq(salesOrders.organizationId, orgId), match, gte(salesOrders.date, since)))
          .groupBy(sql`to_char(${salesOrders.date}, 'YYYY-MM-DD')`),
      ]);
      productCount = Number(pc?.n ?? 0);
      invQty = Number((invRes.rows?.[0] as { q?: string })?.q ?? 0);
      // Fill a continuous 30-day series (0 on days with no sales) so the line is unbroken.
      const byDay = new Map(trendR.map((r) => [r.d, Number(r.t)]));
      salesSeries = Array.from({ length: 30 }, (_, i) => {
        const day = new Date(Date.now() - (29 - i) * 864e5);
        const key = day.toISOString().slice(0, 10);
        return { label: day.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit" }), value: byDay.get(key) ?? 0 };
      });
    } catch {
      analyticsFailed = true;
    }

    const avgOrder = ordersCount > 0 ? salesTotal / ordersCount : 0;
    const outstanding = Number(platform.customerBalance ?? 0);

    // Any platform whose code has a connector with OAuth gets an official-connect
    // card; others stay manual-import only.
    const connector = getConnector(platform.code);
    const connectable = connector?.oauth;
    const conn = connectable ? await getConnection(orgId, connector.code) : null;

    // Latest FBA inventory audit (read-only) — a compact summary here; the full
    // report is its own page (/inventory/reconciliation).
    let audit: typeof inventoryAudits.$inferSelect | null = null;
    let amazonFbaQty = 0; // total units Amazon holds in FBA, from the last audit snapshot
    if (isAmazon) {
      try {
        const [a] = await db.select().from(inventoryAudits)
          .where(and(eq(inventoryAudits.organizationId, orgId), eq(inventoryAudits.provider, "amazon")))
          .orderBy(desc(inventoryAudits.createdAt)).limit(1);
        if (a) {
          audit = a;
          const [{ s }] = await db.select({ s: sql<string>`coalesce(sum(${inventoryAuditLines.amazonTotal}),0)` })
            .from(inventoryAuditLines).where(and(eq(inventoryAuditLines.organizationId, orgId), eq(inventoryAuditLines.auditId, a.id)));
          amazonFbaQty = Number(s ?? 0);
        }
      } catch { /* best-effort — a slow query degrades this section, not the page */ }
    }

    return (
      <div className="space-y-6">
        <ErpPageHeader
          icon="Store"
          title={platform.name}
          subtitle={`منصة ${connector?.label ?? (isAmazon ? "أمازون" : "عامة")} · الكود ${platform.code}${platform.isActive ? "" : " · موقوفة"}`}
          backHref="/platforms"
          action={
            <PlatformHeaderActions
              code={platform.code.toLowerCase()}
              isAmazon={isAmazon}
              connected={!!conn?.connected}
              syncFlags={{ products: platform.syncProducts, orders: platform.syncOrders, inventory: platform.syncInventory }}
              canManage={can("sales.create")}
            />
          }
        />

        {connectable && conn && (
          <MarketplaceConnect
            provider={connector!.code.toLowerCase()}
            label={connector!.label}
            marketplaces={connectable.marketplaces.map((m) => ({ code: m.code, name: m.name, marketplaceId: m.marketplaceId }))}
            conn={conn}
            justConnected={connected === "1"}
            error={connected === "0" ? (err ?? "خطأ غير معروف") : undefined}
            needsShop={connectable.needsTarget}
          />
        )}

        {analyticsFailed && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/20">
            تعذّر تحميل التحليلات مؤقتًا — أعد تحميل الصفحة. (بقية الصفحة تعمل بشكل طبيعي.)
          </div>
        )}

        {isAmazon && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <div>
                  <CardTitle>تدقيق مخزون FBA</CardTitle>
                  <CardDescription>مطابقة كميات أمازون مع مخزن «{platform.warehouseName ?? "غير محدد"}» — قراءة فقط، لا يغيّر المخزون ولا الحسابات.</CardDescription>
                </div>
                {audit && <Link href="/inventory/reconciliation" className="shrink-0 text-sm text-primary hover:underline">التقرير الكامل ←</Link>}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {!audit ? (
                <div className="py-6 text-center text-sm text-muted-foreground">لا يوجد تدقيق بعد — اضغط «تدقيق المخزون» بالأعلى لمطابقة كميات FBA مع النظام.</div>
              ) : (
                <>
                  <AuditStats audit={audit} />
                  <div className="text-xs text-muted-foreground">آخر تدقيق: {new Date(audit.finishedAt ?? audit.createdAt).toLocaleString("ar-EG-u-nu-latn", { dateStyle: "short", timeStyle: "short" })} · يشمل أصناف FBA اللي ليها كمية/حالة فقط (مش كل الكتالوج). التفاصيل في <Link href="/inventory/reconciliation" className="text-primary hover:underline">التقرير الكامل</Link>.</div>
                </>
              )}
            </CardContent>
          </Card>
        )}

        {/* Smart KPIs */}
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
          <Kpi label="عدد المنتجات" value={int(productCount)} hint="أصناف الكتالوج النشطة" />
          {isAmazon && <Kpi label="مخزون أمازون FBA" value={int(amazonFbaQty)} hint={audit ? "الكمية من أمازون · آخر تدقيق" : "شغّل «تدقيق المخزون»"} />}
          <Kpi label={isAmazon ? "مخزون النظام (FBA)" : "مخزون النظام"} value={int(invQty)} hint={platform.warehouseName ? `مخزن ${platform.warehouseName}` : "كل المخازن"} />
          <Kpi label="عدد الأوامر" value={int(ordersCount)} hint={`${int(monthN)} هذا الشهر`} />
          <Kpi label="إجمالي المبيعات" value={fmt(salesTotal)} hint={`${fmt(monthTotal)} هذا الشهر`} />
          <Kpi label="متوسط قيمة الأمر" value={fmt(avgOrder)} />
          <Kpi label="المرتجعات" value={fmt(retTotal)} hint={`${int(retN)} مرتجع`} tone={retTotal > 0 ? "danger" : undefined} />
          <Kpi label="المحصّل (سندات مرحّلة)" value={fmt(collTotal)} tone="ok" />
          <Kpi label="رصيد العميل (مستحق)" value={fmt(outstanding)} tone={outstanding > 0 ? "danger" : undefined} />
        </div>

        {/* Platform P&L */}
        {pnl && (
          <Card>
            <CardHeader>
              <CardTitle>ربحية المنصة (P&L)</CardTitle>
              <CardDescription>إيراد وتكلفة مبيعات المنصة من الفواتير المرحّلة، ورسوم المنصة الفعلية من التسويات.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
                <Field label="المبيعات">{fmt(pnl.revenue)}</Field>
                <Field label={isAmazon ? "عمولة أمازون" : "عمولة المنصة"}>{fmt(pnl.referralFee)}</Field>
                {isAmazon && <Field label="رسوم FBA">{fmt(pnl.fbaFee)}</Field>}
                <Field label="رسوم أخرى">{fmt(pnl.otherFee)}</Field>
                <Field label="تكلفة البضاعة">{fmt(pnl.cogs)}</Field>
                <Field label="صافي الربح">
                  <span className={pnl.net < 0 ? "font-bold text-destructive" : "font-bold text-emerald-600"}>{fmt(pnl.net)}</span>
                  <span className="ms-2 text-xs text-muted-foreground">({pnl.margin.toFixed(1)}%)</span>
                </Field>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Sales trend — last 30 days */}
        <Card>
          <CardHeader><CardTitle>اتجاه المبيعات</CardTitle><CardDescription>إجمالي المبيعات اليومية على المنصة — آخر ٣٠ يومًا.</CardDescription></CardHeader>
          <CardContent>
            {salesSeries.some((s) => s.value > 0)
              ? <TrendChart data={salesSeries} valueLabel="المبيعات" money id="platform-sales" />
              : <div className="py-10 text-center text-sm text-muted-foreground">لا توجد مبيعات في آخر ٣٠ يومًا.</div>}
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Top items */}
          <Card>
            <CardHeader><CardTitle>أعلى الأصناف مبيعًا</CardTitle><CardDescription>حسب قيمة المبيعات على المنصة.</CardDescription></CardHeader>
            <CardContent>
              {topItems.length === 0 ? <div className="py-8 text-center text-sm text-muted-foreground">لا توجد مبيعات بعد.</div> : (
                <Table>
                  <TableHeader><TableRow><TableHead className="text-start">الصنف</TableHead><TableHead className="text-start">الكمية</TableHead><TableHead className="text-start">المبيعات</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {topItems.map((t, i) => (
                      <TableRow key={i}><TableCell className="max-w-[320px] whitespace-normal"><div className="line-clamp-2 leading-snug" title={t.name ?? undefined}><span className="font-mono text-muted-foreground">{t.code}</span> {t.name}</div></TableCell><TableCell>{int(t.qty)}</TableCell><TableCell className="tabular-nums">{fmt(t.total)}</TableCell></TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Recent orders */}
          <Card>
            <CardHeader><CardTitle>آخر الأوامر</CardTitle><CardDescription>أحدث ٨ أوامر مستوردة.</CardDescription></CardHeader>
            <CardContent>
              {recent.length === 0 ? <div className="py-8 text-center text-sm text-muted-foreground">لا توجد أوامر بعد.</div> : (
                <Table>
                  <TableHeader><TableRow><TableHead className="text-start">الرقم</TableHead><TableHead className="text-start">التاريخ</TableHead><TableHead className="text-start">الحالة</TableHead><TableHead className="text-start">الإجمالي</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {recent.map((o) => (
                      <TableRow key={o.number}>
                        <TableCell><Link href={`/sales/orders/${encodeURIComponent(o.number)}`} className="text-primary hover:underline">{o.number}</Link>{o.ext && <div className="font-mono text-[10px] text-muted-foreground">{o.ext}</div>}</TableCell>
                        <TableCell>{dt(o.date)}</TableCell>
                        <TableCell><Badge variant="outline">{STATUS[o.status]?.label ?? o.status}</Badge></TableCell>
                        <TableCell className="tabular-nums">{fmt(o.total)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>

        {statusRows.length > 0 && (
          <Card>
            <CardHeader><CardTitle>توزيع حالات الأوامر</CardTitle><CardDescription>عدد الأوامر حسب الحالة.</CardDescription></CardHeader>
            <CardContent>
              <StatusDonut
                unit="أمر"
                data={statusRows.map((s) => ({ name: STATUS[s.status]?.label ?? s.status, value: Number(s.n), color: STATUS[s.status]?.color ?? "#94a3b8" }))}
              />
            </CardContent>
          </Card>
        )}
      </div>
    );
  }, "marketplace");
}
