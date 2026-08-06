import Link from "next/link";
import { and, asc, count, desc, eq, gte, ilike, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { salesOrders, salesOrderLines, customers, salesReturns, salesReturnLines } from "@/db/schema";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Icon } from "@/components/icon";
import { ErpPageHeader } from "@/components/erp/page-header";
import { SalesOrdersTable } from "@/components/erp/sales-orders-table";
import { selectCls } from "@/lib/utils";

const PER_PAGE = 10;
const money = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const STATUS_OPTIONS: [string, string][] = [
  ["DRAFT", "مسودة"], ["CONFIRMED", "مؤكّد"], ["PARTIALLY_DELIVERED", "تسليم جزئي"],
  ["DELIVERED", "تم التسليم"], ["INVOICED", "مفوتر"], ["CANCELLED", "ملغى"],
];
const CHANNEL_OPTIONS: [string, string][] = [["AMAZON", "أمازون"], ["NOON", "نون"], ["SHOPIFY", "شوبيفاي"], ["MANUAL", "يدوي"]];

type SP = { [k: string]: string | string[] | undefined };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function SalesOrdersPage({ searchParams }: { searchParams: Promise<SP> }) {
  return loadErpPage("sales.view", async ({ orgId, role, can }) => {
    const canManage = can("sales.create");
    const canConfirm = can("sales.confirm");
    const sp = await searchParams;
    const q = one(sp.q).trim();
    const fStatus = one(sp.status);
    const fChannel = one(sp.channel);
    const fCustomer = one(sp.customer);
    const from = one(sp.from);
    const to = one(sp.to);
    const page = Math.max(1, parseInt(one(sp.page) || "1", 10) || 1);

    const conds = [eq(salesOrders.organizationId, orgId)];
    if (q) conds.push(or(ilike(salesOrders.number, `%${q}%`), ilike(salesOrders.externalOrderId, `%${q}%`))!);
    if (fStatus) conds.push(eq(salesOrders.status, fStatus));
    if (fChannel === "MANUAL") conds.push(isNull(salesOrders.channel));
    else if (fChannel) conds.push(eq(salesOrders.channel, fChannel));
    if (fCustomer) conds.push(eq(salesOrders.customerId, fCustomer));
    if (from) conds.push(gte(salesOrders.date, new Date(from)));
    if (to) conds.push(lte(salesOrders.date, new Date(to + "T23:59:59")));
    const where = and(...conds);

    const [custList, [{ total }], [sum]] = await Promise.all([
      db.select({ id: customers.id, nameAr: customers.nameAr }).from(customers).where(eq(customers.organizationId, orgId)).orderBy(asc(customers.code)),
      db.select({ total: count() }).from(salesOrders).where(where),
      // Filter-aware pipeline value: total, still-open (not invoiced/cancelled), invoiced.
      db.select({
        value: sql<string>`coalesce(sum(${salesOrders.totalAmount}), 0)`,
        open: sql<string>`coalesce(sum(${salesOrders.totalAmount}) filter (where ${salesOrders.status} not in ('INVOICED','CANCELLED')), 0)`,
        invoiced: sql<string>`coalesce(sum(${salesOrders.totalAmount}) filter (where ${salesOrders.status} = 'INVOICED'), 0)`,
      }).from(salesOrders).where(where),
    ]);
    const totalValue = Number(sum?.value ?? 0);
    const openValue = Number(sum?.open ?? 0);
    const invoicedValue = Number(sum?.invoiced ?? 0);
    const pages = Math.max(1, Math.ceil(Number(total) / PER_PAGE));
    const safePage = Math.min(page, pages);

    const rows = await db
      .select({ id: salesOrders.id, number: salesOrders.number, date: salesOrders.date, total: salesOrders.totalAmount, status: salesOrders.status, customer: customers.nameAr, channel: salesOrders.channel, externalOrderId: salesOrders.externalOrderId, channelStatus: salesOrders.channelStatus })
      .from(salesOrders)
      .leftJoin(customers, eq(customers.id, salesOrders.customerId))
      .where(where)
      .orderBy(desc(salesOrders.date), desc(salesOrders.number))
      .limit(PER_PAGE)
      .offset((safePage - 1) * PER_PAGE);

    // Delivered progress (delivered qty / ordered qty) per order on this page.
    const ids = rows.map((r) => r.id);
    const agg = ids.length
      ? await db.select({
          soId: salesOrderLines.salesOrderId,
          ordered: sql<string>`coalesce(sum(${salesOrderLines.quantity}),0)`,
          delivered: sql<string>`coalesce(sum(${salesOrderLines.deliveredQty}),0)`,
        }).from(salesOrderLines).where(inArray(salesOrderLines.salesOrderId, ids)).groupBy(salesOrderLines.salesOrderId)
      : [];
    const aggBy = new Map(agg.map((a) => [a.soId, { ordered: Number(a.ordered), delivered: Number(a.delivered) }]));

    // Returns linked to each order (stock returns from its deliveries + money returns from its invoices) — shown as sub-rows.
    const retRows = ids.length
      ? await db.select({ id: salesReturns.id, number: salesReturns.number, date: salesReturns.date, status: salesReturns.status, soId: salesReturns.salesOrderId })
          .from(salesReturns)
          .where(and(eq(salesReturns.organizationId, orgId), inArray(salesReturns.salesOrderId, ids)))
          .orderBy(desc(salesReturns.date), desc(salesReturns.number))
      : [];
    const retIds = retRows.map((r) => r.id);
    const qtyRows = retIds.length
      ? await db.select({ rid: salesReturnLines.salesReturnId, qty: sql<string>`coalesce(sum(${salesReturnLines.quantity}),0)` })
          .from(salesReturnLines).where(inArray(salesReturnLines.salesReturnId, retIds)).groupBy(salesReturnLines.salesReturnId)
      : [];
    const qtyByRet = new Map(qtyRows.map((r) => [r.rid, Number(r.qty)]));
    const retsBySo = new Map<string, { id: string; number: string; date: Date; qty: number; status: string }[]>();
    for (const r of retRows) {
      if (!r.soId) continue;
      const list = retsBySo.get(r.soId) ?? [];
      list.push({ id: r.id, number: r.number, date: r.date, qty: qtyByRet.get(r.id) ?? 0, status: r.status });
      retsBySo.set(r.soId, list);
    }
    const tableRows = rows.map((r) => ({
      ...r,
      orderedQty: aggBy.get(r.id)?.ordered ?? 0, deliveredQty: aggBy.get(r.id)?.delivered ?? 0,
      returned: (retsBySo.get(r.id) ?? []).some((x) => x.status === "POSTED"),
      returns: retsBySo.get(r.id) ?? [],
    }));

    const hasFilters = Boolean(q || fStatus || fChannel || fCustomer || from || to);
    const qs = (p: number) => {
      const u = new URLSearchParams();
      if (q) u.set("q", q);
      if (fStatus) u.set("status", fStatus);
      if (fChannel) u.set("channel", fChannel);
      if (fCustomer) u.set("customer", fCustomer);
      if (from) u.set("from", from);
      if (to) u.set("to", to);
      u.set("page", String(p));
      return `?${u.toString()}`;
    };

    return (
      <div className="space-y-6">
        <ErpPageHeader
          icon="ClipboardList"
          title="أوامر البيع"
          subtitle={`${total} أمر`}
          action={canManage ? (
            <div className="flex gap-2">
              <Button variant="outline" asChild><Link href="/platforms"><Icon name="Store" className="size-4" />المنصات (الاستيراد والتسويات)</Link></Button>
              <Button asChild><Link href="/sales/orders/new"><Icon name="Plus" className="size-4" />أمر بيع</Link></Button>
            </div>
          ) : undefined}
        />

        <div className="grid gap-4 sm:grid-cols-3">
          <Card><CardContent className="pt-6"><div className="text-sm text-muted-foreground">إجمالي القيمة</div><p className="mt-1 text-2xl font-bold tabular-nums">{money(totalValue)}</p></CardContent></Card>
          <Card><CardContent className="pt-6"><div className="text-sm text-muted-foreground">قيمة الأوامر المفتوحة</div><p className="mt-1 text-2xl font-bold tabular-nums text-amber-600">{money(openValue)}</p></CardContent></Card>
          <Card><CardContent className="pt-6"><div className="text-sm text-muted-foreground">قيمة المفوترة</div><p className="mt-1 text-2xl font-bold tabular-nums text-emerald-600">{money(invoicedValue)}</p></CardContent></Card>
        </div>

        <Card>
          <CardContent className="space-y-4 pt-6">
            <details open={hasFilters} className="rounded-lg border">
              <summary className="flex cursor-pointer select-none items-center gap-2 px-4 py-2 text-sm font-medium">
                <Icon name="ListFilter" className="size-4" /> بحث وتصفية
              </summary>
              <form className="grid gap-3 p-4 pt-0 sm:grid-cols-6 items-end">
                <div className="space-y-1"><Label htmlFor="q">رقم الأمر / أمازون</Label><Input id="q" name="q" defaultValue={q} placeholder="SO-2026-... أو 407-..." /></div>
                <div className="space-y-1">
                  <Label htmlFor="status">الحالة</Label>
                  <select id="status" name="status" defaultValue={fStatus} className={selectCls}>
                    <option value="">الكل</option>
                    {STATUS_OPTIONS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="channel">القناة</Label>
                  <select id="channel" name="channel" defaultValue={fChannel} className={selectCls}>
                    <option value="">الكل</option>
                    {CHANNEL_OPTIONS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="customer">العميل</Label>
                  <select id="customer" name="customer" defaultValue={fCustomer} className={selectCls}>
                    <option value="">الكل</option>
                    {custList.map((c) => <option key={c.id} value={c.id}>{c.nameAr}</option>)}
                  </select>
                </div>
                <div className="space-y-1"><Label htmlFor="from">من تاريخ</Label><Input id="from" name="from" type="date" defaultValue={from} /></div>
                <div className="space-y-1"><Label htmlFor="to">إلى تاريخ</Label><Input id="to" name="to" type="date" defaultValue={to} /></div>
                <div className="flex gap-2 sm:col-span-6">
                  <Button type="submit">تطبيق</Button>
                  {hasFilters && <Button type="button" variant="outline" asChild><Link href="/sales/orders">مسح</Link></Button>}
                </div>
              </form>
            </details>

            {tableRows.length === 0 ? (
              <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">{hasFilters ? "لا توجد نتائج مطابقة." : "لا توجد أوامر بيع بعد."}</div>
            ) : (
              <>
                <SalesOrdersTable rows={tableRows} canConfirm={canConfirm} canCreate={canManage} total={Number(total)} filter={{ q, status: fStatus, customer: fCustomer, from, to }} />
                <div className="flex items-center justify-between text-sm text-muted-foreground">
                  <span>صفحة {safePage} من {pages}</span>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" disabled={safePage <= 1} asChild={safePage > 1}>
                      {safePage > 1 ? <a href={qs(safePage - 1)}>السابق</a> : <span>السابق</span>}
                    </Button>
                    <Button variant="outline" size="sm" disabled={safePage >= pages} asChild={safePage < pages}>
                      {safePage < pages ? <a href={qs(safePage + 1)}>التالي</a> : <span>التالي</span>}
                    </Button>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    );
  });
}
