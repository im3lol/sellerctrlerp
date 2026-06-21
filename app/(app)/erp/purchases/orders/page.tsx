import Link from "next/link";
import { and, asc, count, desc, eq, gte, ilike, inArray, lte, sql } from "drizzle-orm";
import { requireErpModule, erpCan } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { purchaseOrders, purchaseOrderLines, suppliers } from "@/db/schema";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Icon } from "@/components/icon";
import { ErpPageHeader } from "@/components/erp/page-header";
import { PurchaseOrdersTable } from "@/components/erp/purchase-orders-table";

const PER_PAGE = 10;
const selectCls = "flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm";
const STATUS_OPTIONS: [string, string][] = [
  ["DRAFT", "مسودة"], ["CONFIRMED", "مؤكّد"], ["PARTIALLY_RECEIVED", "استلام جزئي"],
  ["RECEIVED", "تم الاستلام"], ["INVOICED", "مفوتر"], ["CANCELLED", "ملغى"],
];

type SP = { [k: string]: string | string[] | undefined };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function PurchaseOrdersPage({ searchParams }: { searchParams: Promise<SP> }) {
  const { orgId, role } = await requireErpModule("purchases.view");
  const canManage = erpCan(role, "purchases.create");
  const sp = await searchParams;
  const q = one(sp.q).trim();
  const fStatus = one(sp.status);
  const fSupplier = one(sp.supplier);
  const from = one(sp.from);
  const to = one(sp.to);
  const page = Math.max(1, parseInt(one(sp.page) || "1", 10) || 1);

  const conds = [eq(purchaseOrders.organizationId, orgId)];
  if (q) conds.push(ilike(purchaseOrders.number, `%${q}%`));
  if (fStatus) conds.push(eq(purchaseOrders.status, fStatus));
  if (fSupplier) conds.push(eq(purchaseOrders.supplierId, fSupplier));
  if (from) conds.push(gte(purchaseOrders.date, new Date(from)));
  if (to) conds.push(lte(purchaseOrders.date, new Date(to + "T23:59:59")));
  const where = and(...conds);

  const [supList, [{ total }]] = await Promise.all([
    db.select({ id: suppliers.id, nameAr: suppliers.nameAr }).from(suppliers).where(eq(suppliers.organizationId, orgId)).orderBy(asc(suppliers.code)),
    db.select({ total: count() }).from(purchaseOrders).where(where),
  ]);
  const pages = Math.max(1, Math.ceil(Number(total) / PER_PAGE));
  const safePage = Math.min(page, pages);

  const rows = await db
    .select({ id: purchaseOrders.id, number: purchaseOrders.number, date: purchaseOrders.date, total: purchaseOrders.totalAmount, status: purchaseOrders.status, supplier: suppliers.nameAr })
    .from(purchaseOrders)
    .leftJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
    .where(where)
    .orderBy(desc(purchaseOrders.date), desc(purchaseOrders.number))
    .limit(PER_PAGE)
    .offset((safePage - 1) * PER_PAGE);

  // Received progress (received qty / ordered qty) per order on this page.
  const ids = rows.map((r) => r.id);
  const agg = ids.length
    ? await db.select({
        poId: purchaseOrderLines.purchaseOrderId,
        ordered: sql<string>`coalesce(sum(${purchaseOrderLines.quantity}),0)`,
        received: sql<string>`coalesce(sum(${purchaseOrderLines.receivedQty}),0)`,
      }).from(purchaseOrderLines).where(inArray(purchaseOrderLines.purchaseOrderId, ids)).groupBy(purchaseOrderLines.purchaseOrderId)
    : [];
  const aggBy = new Map(agg.map((a) => [a.poId, { ordered: Number(a.ordered), received: Number(a.received) }]));
  const tableRows = rows.map((r) => ({ ...r, orderedQty: aggBy.get(r.id)?.ordered ?? 0, receivedQty: aggBy.get(r.id)?.received ?? 0 }));

  const hasFilters = Boolean(q || fStatus || fSupplier || from || to);
  const qs = (p: number) => {
    const u = new URLSearchParams();
    if (q) u.set("q", q);
    if (fStatus) u.set("status", fStatus);
    if (fSupplier) u.set("supplier", fSupplier);
    if (from) u.set("from", from);
    if (to) u.set("to", to);
    u.set("page", String(p));
    return `?${u.toString()}`;
  };

  return (
    <div className="space-y-6">
      <ErpPageHeader
        icon="ClipboardList"
        title="أوامر الشراء"
        subtitle={`${total} أمر`}
        action={canManage ? (
          <Button asChild><Link href="/erp/purchases/orders/new"><Icon name="Plus" className="size-4" />أمر شراء</Link></Button>
        ) : undefined}
      />
      <Card>
        <CardHeader>
          <CardTitle>أوامر الشراء</CardTitle>
          <CardDescription>التزامات شراء تُحوّل إلى فواتير. حدّد عدّة أوامر لتأكيدها أو إلغائها أو حذفها دفعةً واحدة.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <details open={hasFilters} className="rounded-lg border">
            <summary className="flex cursor-pointer select-none items-center gap-2 px-4 py-2 text-sm font-medium">
              <Icon name="ListFilter" className="size-4" /> بحث وتصفية
            </summary>
            <form className="grid gap-3 p-4 pt-0 sm:grid-cols-5 items-end">
              <div className="space-y-1"><Label htmlFor="q">رقم الأمر</Label><Input id="q" name="q" defaultValue={q} placeholder="PO-2026-..." /></div>
              <div className="space-y-1">
                <Label htmlFor="status">الحالة</Label>
                <select id="status" name="status" defaultValue={fStatus} className={selectCls}>
                  <option value="">الكل</option>
                  {STATUS_OPTIONS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="supplier">المورد</Label>
                <select id="supplier" name="supplier" defaultValue={fSupplier} className={selectCls}>
                  <option value="">الكل</option>
                  {supList.map((s) => <option key={s.id} value={s.id}>{s.nameAr}</option>)}
                </select>
              </div>
              <div className="space-y-1"><Label htmlFor="from">من تاريخ</Label><Input id="from" name="from" type="date" defaultValue={from} /></div>
              <div className="space-y-1"><Label htmlFor="to">إلى تاريخ</Label><Input id="to" name="to" type="date" defaultValue={to} /></div>
              <div className="flex gap-2 sm:col-span-5">
                <Button type="submit">تطبيق</Button>
                {hasFilters && <Button type="button" variant="outline" asChild><a href="/erp/purchases/orders">مسح</a></Button>}
              </div>
            </form>
          </details>

          {rows.length === 0 ? (
            <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">{hasFilters ? "لا توجد نتائج مطابقة." : "لا توجد أوامر شراء بعد."}</div>
          ) : (
            <>
              <PurchaseOrdersTable rows={tableRows} canManage={canManage} />
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
