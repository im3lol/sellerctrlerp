import Link from "next/link";
import { and, asc, count, desc, eq, gte, ilike, inArray, lte, sql } from "drizzle-orm";
import { requireErpModule, erpCan } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { salesOrders, salesOrderLines, customers } from "@/db/schema";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Icon } from "@/components/icon";
import { ErpPageHeader } from "@/components/erp/page-header";
import { SalesOrdersTable } from "@/components/erp/sales-orders-table";

const PER_PAGE = 10;
const selectCls = "flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm";
const STATUS_OPTIONS: [string, string][] = [
  ["DRAFT", "مسودة"], ["CONFIRMED", "مؤكّد"], ["PARTIALLY_DELIVERED", "تسليم جزئي"],
  ["DELIVERED", "تم التسليم"], ["INVOICED", "مفوتر"], ["CANCELLED", "ملغى"],
];

type SP = { [k: string]: string | string[] | undefined };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function SalesOrdersPage({ searchParams }: { searchParams: Promise<SP> }) {
  const { orgId, role } = await requireErpModule("sales.view");
  const canManage = erpCan(role, "sales.create");
  const sp = await searchParams;
  const q = one(sp.q).trim();
  const fStatus = one(sp.status);
  const fCustomer = one(sp.customer);
  const from = one(sp.from);
  const to = one(sp.to);
  const page = Math.max(1, parseInt(one(sp.page) || "1", 10) || 1);

  const conds = [eq(salesOrders.organizationId, orgId)];
  if (q) conds.push(ilike(salesOrders.number, `%${q}%`));
  if (fStatus) conds.push(eq(salesOrders.status, fStatus));
  if (fCustomer) conds.push(eq(salesOrders.customerId, fCustomer));
  if (from) conds.push(gte(salesOrders.date, new Date(from)));
  if (to) conds.push(lte(salesOrders.date, new Date(to + "T23:59:59")));
  const where = and(...conds);

  const [custList, [{ total }]] = await Promise.all([
    db.select({ id: customers.id, nameAr: customers.nameAr }).from(customers).where(eq(customers.organizationId, orgId)).orderBy(asc(customers.code)),
    db.select({ total: count() }).from(salesOrders).where(where),
  ]);
  const pages = Math.max(1, Math.ceil(Number(total) / PER_PAGE));
  const safePage = Math.min(page, pages);

  const rows = await db
    .select({ id: salesOrders.id, number: salesOrders.number, date: salesOrders.date, total: salesOrders.totalAmount, status: salesOrders.status, customer: customers.nameAr })
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
  const tableRows = rows.map((r) => ({ ...r, orderedQty: aggBy.get(r.id)?.ordered ?? 0, deliveredQty: aggBy.get(r.id)?.delivered ?? 0 }));

  const hasFilters = Boolean(q || fStatus || fCustomer || from || to);
  const qs = (p: number) => {
    const u = new URLSearchParams();
    if (q) u.set("q", q);
    if (fStatus) u.set("status", fStatus);
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
          <Button asChild><Link href="/erp/sales/orders/new"><Icon name="Plus" className="size-4" />أمر بيع</Link></Button>
        ) : undefined}
      />
      <Card>
        <CardHeader>
          <CardTitle>أوامر البيع</CardTitle>
          <CardDescription>التزامات بيع تُحوّل إلى فواتير. حدّد عدّة أوامر لتأكيدها أو إلغائها أو حذفها دفعةً واحدة.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <details open={hasFilters} className="rounded-lg border">
            <summary className="flex cursor-pointer select-none items-center gap-2 px-4 py-2 text-sm font-medium">
              <Icon name="ListFilter" className="size-4" /> بحث وتصفية
            </summary>
            <form className="grid gap-3 p-4 pt-0 sm:grid-cols-5 items-end">
              <div className="space-y-1"><Label htmlFor="q">رقم الأمر</Label><Input id="q" name="q" defaultValue={q} placeholder="SO-2026-..." /></div>
              <div className="space-y-1">
                <Label htmlFor="status">الحالة</Label>
                <select id="status" name="status" defaultValue={fStatus} className={selectCls}>
                  <option value="">الكل</option>
                  {STATUS_OPTIONS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
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
              <div className="flex gap-2 sm:col-span-5">
                <Button type="submit">تطبيق</Button>
                {hasFilters && <Button type="button" variant="outline" asChild><a href="/erp/sales/orders">مسح</a></Button>}
              </div>
            </form>
          </details>

          {tableRows.length === 0 ? (
            <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">{hasFilters ? "لا توجد نتائج مطابقة." : "لا توجد أوامر بيع بعد."}</div>
          ) : (
            <>
              <SalesOrdersTable rows={tableRows} canManage={canManage} />
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
}
