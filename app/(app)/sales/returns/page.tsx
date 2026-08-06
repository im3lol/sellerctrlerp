import Link from "next/link";
import { and, count, desc, eq, gte, ilike, isNull, lte, ne, or, sql } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { salesReturns, customers, salesOrders } from "@/db/schema";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Icon } from "@/components/icon";
import { ErpPageHeader } from "@/components/erp/page-header";
import { SalesReturnsTable, type ReturnRow } from "@/components/erp/sales-returns-table";
import { selectCls } from "@/lib/utils";

const PER_PAGE = 15;
const money = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const STATUS_OPTIONS: [string, string][] = [["DRAFT", "مسودة"], ["POSTED", "مُرحّل"], ["CANCELLED", "ملغى"]];
const CHANNEL_OPTIONS: [string, string][] = [["AMAZON", "أمازون"], ["NOON", "نون"], ["SHOPIFY", "شوبيفاي"], ["MANUAL", "يدوي"]];

type SP = { [k: string]: string | string[] | undefined };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function SalesReturnsPage({ searchParams }: { searchParams: Promise<SP> }) {
  return loadErpPage("sales.view", async ({ orgId, can }) => {
    const canConfirm = can("sales.confirm");
    const canCreate = can("sales.create");
    const sp = await searchParams;
    const q = one(sp.q).trim();
    const fStatus = one(sp.status);
    const fChannel = one(sp.channel);
    const fDisposition = one(sp.disposition); // "SELLABLE" | "UNSELLABLE"
    const from = one(sp.from);
    const to = one(sp.to);
    const page = Math.max(1, parseInt(one(sp.page) || "1", 10) || 1);

    const conds = [eq(salesReturns.organizationId, orgId)];
    if (q) conds.push(or(ilike(salesReturns.number, `%${q}%`), ilike(salesReturns.externalReturnId, `%${q}%`))!);
    if (fStatus) conds.push(eq(salesReturns.status, fStatus));
    if (fChannel === "MANUAL") conds.push(isNull(salesReturns.channel));
    else if (fChannel) conds.push(eq(salesReturns.channel, fChannel));
    if (fDisposition === "SELLABLE") conds.push(eq(salesReturns.disposition, "SELLABLE"));
    else if (fDisposition === "UNSELLABLE") conds.push(and(sql`${salesReturns.disposition} is not null`, ne(salesReturns.disposition, "SELLABLE"))!);
    if (from) conds.push(gte(salesReturns.date, new Date(from)));
    if (to) conds.push(lte(salesReturns.date, new Date(to + "T23:59:59")));
    const where = and(...conds);

    const [[{ total }], [sum]] = await Promise.all([
      db.select({ total: count() }).from(salesReturns).where(where),
      db.select({
        value: sql<string>`coalesce(sum(${salesReturns.totalAmount}), 0)`,
        draft: sql<number>`count(*) filter (where ${salesReturns.status} = 'DRAFT')`,
        // Value of unsellable/damaged returns — the write-off / segregation exposure.
        unsellable: sql<string>`coalesce(sum(${salesReturns.totalAmount}) filter (where ${salesReturns.disposition} is not null and ${salesReturns.disposition} <> 'SELLABLE'), 0)`,
      }).from(salesReturns).where(where),
    ]);
    const totalValue = Number(sum?.value ?? 0);
    const draftCount = Number(sum?.draft ?? 0);
    const unsellableValue = Number(sum?.unsellable ?? 0);
    const pages = Math.max(1, Math.ceil(Number(total) / PER_PAGE));
    const safePage = Math.min(page, pages);

    const rows: ReturnRow[] = await db
      .select({
        id: salesReturns.id, number: salesReturns.number, date: salesReturns.date,
        customer: customers.nameAr, channel: salesReturns.channel, externalReturnId: salesReturns.externalReturnId,
        reason: salesReturns.reason, disposition: salesReturns.disposition,
        orderNumber: salesOrders.number, total: salesReturns.totalAmount, status: salesReturns.status,
      })
      .from(salesReturns)
      .leftJoin(customers, eq(customers.id, salesReturns.customerId))
      .leftJoin(salesOrders, eq(salesOrders.id, salesReturns.salesOrderId))
      .where(where)
      .orderBy(desc(salesReturns.date), desc(salesReturns.number))
      .limit(PER_PAGE)
      .offset((safePage - 1) * PER_PAGE);

    const hasFilters = Boolean(q || fStatus || fChannel || fDisposition || from || to);
    const qs = (p: number) => {
      const u = new URLSearchParams();
      if (q) u.set("q", q);
      if (fStatus) u.set("status", fStatus);
      if (fChannel) u.set("channel", fChannel);
      if (fDisposition) u.set("disposition", fDisposition);
      if (from) u.set("from", from);
      if (to) u.set("to", to);
      u.set("page", String(p));
      return `?${u.toString()}`;
    };

    return (
      <div className="space-y-6">
        <ErpPageHeader icon="Undo2" title="مرتجعات المبيعات" subtitle={`${total} مرتجع`} />

        <div className="grid gap-4 sm:grid-cols-3">
          <Card><CardContent className="pt-6"><div className="text-sm text-muted-foreground">إجمالي قيمة المرتجعات</div><p className="mt-1 text-2xl font-bold tabular-nums">{money(totalValue)}</p></CardContent></Card>
          <Card><CardContent className="pt-6"><div className="text-sm text-muted-foreground">غير مؤكّدة (مسودة)</div><p className="mt-1 text-2xl font-bold tabular-nums text-amber-600">{draftCount.toLocaleString("ar-EG-u-nu-latn")}</p></CardContent></Card>
          <Card><CardContent className="pt-6"><div className="text-sm text-muted-foreground">قيمة التالف / غير القابل للبيع</div><p className="mt-1 text-2xl font-bold tabular-nums text-destructive">{money(unsellableValue)}</p></CardContent></Card>
        </div>

        <Card>
          <CardContent className="space-y-4 pt-6">
            <details open={hasFilters} className="rounded-lg border">
              <summary className="flex cursor-pointer select-none items-center gap-2 px-4 py-2 text-sm font-medium">
                <Icon name="ListFilter" className="size-4" /> بحث وتصفية
              </summary>
              <form className="grid gap-3 p-4 pt-0 sm:grid-cols-6 items-end">
                <div className="space-y-1"><Label htmlFor="q">الرقم / رقم أمازون</Label><Input id="q" name="q" defaultValue={q} placeholder="SR-2026-... أو 407-..." /></div>
                <div className="space-y-1">
                  <Label htmlFor="status">المستند</Label>
                  <select id="status" name="status" defaultValue={fStatus} className={selectCls}>
                    <option value="">الكل</option>
                    {STATUS_OPTIONS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="channel">المصدر</Label>
                  <select id="channel" name="channel" defaultValue={fChannel} className={selectCls}>
                    <option value="">الكل</option>
                    {CHANNEL_OPTIONS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="disposition">الحالة</Label>
                  <select id="disposition" name="disposition" defaultValue={fDisposition} className={selectCls}>
                    <option value="">الكل</option>
                    <option value="SELLABLE">قابل للبيع</option>
                    <option value="UNSELLABLE">تالف / غير قابل للبيع</option>
                  </select>
                </div>
                <div className="space-y-1"><Label htmlFor="from">من تاريخ</Label><Input id="from" name="from" type="date" defaultValue={from} /></div>
                <div className="space-y-1"><Label htmlFor="to">إلى تاريخ</Label><Input id="to" name="to" type="date" defaultValue={to} /></div>
                <div className="flex gap-2 sm:col-span-6">
                  <Button type="submit">تطبيق</Button>
                  {hasFilters && <Button type="button" variant="outline" asChild><Link href="/sales/returns">مسح</Link></Button>}
                </div>
              </form>
            </details>

            {rows.length === 0 ? (
              <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">
                {hasFilters ? "لا توجد نتائج مطابقة." : "لا توجد مرتجعات بعد. مرتجعات المنصّات (FBA) تظهر هنا تلقائيًا كمسودّات بعد المزامنة."}
              </div>
            ) : (
              <>
                <SalesReturnsTable rows={rows} canConfirm={canConfirm} canCreate={canCreate} />
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
