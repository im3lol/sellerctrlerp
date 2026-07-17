import { notFound } from "next/navigation";
import Link from "next/link";
import { and, desc, eq, gte, or, sql } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { salesPlatforms, salesOrders, salesOrderLines, salesReturns, receiptVouchers, customers, warehouses, bankAccounts, items } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PlatformActions } from "@/components/erp/platform-actions";
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
  return loadErpPage("sales.view", async ({ orgId }) => {
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
            ORDER BY item_id, warehouse_id, created_at DESC, number DESC
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

    return (
      <div className="space-y-6">
        <ErpPageHeader
          icon="Store"
          title={platform.name}
          subtitle={`منصة ${isAmazon ? "أمازون" : "عامة"} · الكود ${platform.code}${platform.isActive ? "" : " · موقوفة"}`}
          backHref="/erp/platforms"
          action={<PlatformActions code={platform.code.toLowerCase()} isAmazon={isAmazon} />}
        />

        {connectable && conn && (
          <MarketplaceConnect
            provider={connector!.code.toLowerCase()}
            label={connector!.label}
            marketplaces={connectable.marketplaces.map((m) => ({ code: m.code, name: m.name, marketplaceId: m.marketplaceId }))}
            conn={conn}
            syncFlags={{ products: platform.syncProducts, orders: platform.syncOrders, inventory: platform.syncInventory }}
            justConnected={connected === "1"}
            error={connected === "0" ? (err ?? "خطأ غير معروف") : undefined}
          />
        )}

        {analyticsFailed && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/20">
            تعذّر تحميل التحليلات مؤقتًا — أعد تحميل الصفحة. (بقية الصفحة تعمل بشكل طبيعي.)
          </div>
        )}

        {/* Smart KPIs */}
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
          <Kpi label="عدد المنتجات" value={int(productCount)} hint="أصناف الكتالوج النشطة" />
          <Kpi label="كمية المخزون" value={int(invQty)} hint={platform.warehouseName ? `مخزن ${platform.warehouseName}` : "كل المخازن"} />
          <Kpi label="عدد الأوامر" value={int(ordersCount)} hint={`${int(monthN)} هذا الشهر`} />
          <Kpi label="إجمالي المبيعات" value={fmt(salesTotal)} hint={`${fmt(monthTotal)} هذا الشهر`} />
          <Kpi label="متوسط قيمة الأمر" value={fmt(avgOrder)} />
          <Kpi label="المرتجعات" value={fmt(retTotal)} hint={`${int(retN)} مرتجع`} tone={retTotal > 0 ? "danger" : undefined} />
          <Kpi label="المحصّل (سندات مرحّلة)" value={fmt(collTotal)} tone="ok" />
          <Kpi label="رصيد العميل (مستحق)" value={fmt(outstanding)} tone={outstanding > 0 ? "danger" : undefined} />
        </div>

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
                      <TableRow key={i}><TableCell><span className="font-mono text-muted-foreground">{t.code}</span> {t.name}</TableCell><TableCell>{int(t.qty)}</TableCell><TableCell className="tabular-nums">{fmt(t.total)}</TableCell></TableRow>
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
                        <TableCell><Link href={`/erp/sales/orders/${encodeURIComponent(o.number)}`} className="text-primary hover:underline">{o.number}</Link>{o.ext && <div className="font-mono text-[10px] text-muted-foreground">{o.ext}</div>}</TableCell>
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
