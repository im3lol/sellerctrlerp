import Link from "next/link";
import { and, asc, count, desc, eq, gte, ilike, inArray, lte, sql } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { purchaseOrders, purchaseOrderLines, suppliers, purchaseReturns, purchaseReturnLines } from "@/db/schema";
import { getApprovalPolicy } from "@/lib/erp/approvals";
import { needsApproval } from "@/lib/erp/approval-policy";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Icon } from "@/components/icon";
import { ErpPageHeader } from "@/components/erp/page-header";
import { PurchaseOrdersTable } from "@/components/erp/purchase-orders-table";
import { OrdersKanban, type KanbanCard } from "@/components/erp/kanban-board";
import { cn, selectCls } from "@/lib/utils";

const PER_PAGE = 10;
/** The board shows every status at once, so it takes the latest N under the filters. */
const BOARD_LIMIT = 300;
const day = (d: Date) => new Date(d).toLocaleDateString("ar-EG-u-nu-latn", { day: "numeric", month: "short" });
const money = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const STATUS_OPTIONS: [string, string][] = [
  ["DRAFT", "مسودة"], ["CONFIRMED", "مؤكّد"], ["PARTIALLY_RECEIVED", "استلام جزئي"],
  ["RECEIVED", "تم الاستلام"], ["INVOICED", "مفوتر"], ["CANCELLED", "ملغى"],
];

type SP = { [k: string]: string | string[] | undefined };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function PurchaseOrdersPage({ searchParams }: { searchParams: Promise<SP> }) {
  return loadErpPage("purchases.view", async ({ orgId, can }) => {
    const canManage = can("purchases.create");
    const canConfirm = can("purchases.confirm");
    const sp = await searchParams;
    const q = one(sp.q).trim();
    const fStatus = one(sp.status);
    const fSupplier = one(sp.supplier);
    const from = one(sp.from);
    const to = one(sp.to);
    const page = Math.max(1, parseInt(one(sp.page) || "1", 10) || 1);
    const view = one(sp.view) === "board" ? "board" : "table";

    const conds = [eq(purchaseOrders.organizationId, orgId)];
    if (q) conds.push(ilike(purchaseOrders.number, `%${q}%`));
    if (fStatus) conds.push(eq(purchaseOrders.status, fStatus));
    if (fSupplier) conds.push(eq(purchaseOrders.supplierId, fSupplier));
    if (from) conds.push(gte(purchaseOrders.date, new Date(from)));
    if (to) conds.push(lte(purchaseOrders.date, new Date(to + "T23:59:59")));
    const where = and(...conds);

    const [supList, [{ total }], [sum]] = await Promise.all([
      db.select({ id: suppliers.id, nameAr: suppliers.nameAr }).from(suppliers).where(eq(suppliers.organizationId, orgId)).orderBy(asc(suppliers.code)),
      db.select({ total: count() }).from(purchaseOrders).where(where),
      // Filter-aware commitment value: total, still-open (not invoiced/cancelled), invoiced.
      db.select({
        value: sql<string>`coalesce(sum(${purchaseOrders.totalAmount}), 0)`,
        open: sql<string>`coalesce(sum(${purchaseOrders.totalAmount}) filter (where ${purchaseOrders.status} not in ('INVOICED','CANCELLED')), 0)`,
        invoiced: sql<string>`coalesce(sum(${purchaseOrders.totalAmount}) filter (where ${purchaseOrders.status} = 'INVOICED'), 0)`,
      }).from(purchaseOrders).where(where),
    ]);
    const totalValue = Number(sum?.value ?? 0);
    const openValue = Number(sum?.open ?? 0);
    const invoicedValue = Number(sum?.invoiced ?? 0);
    const pages = Math.max(1, Math.ceil(Number(total) / PER_PAGE));
    const safePage = Math.min(page, pages);

    const policy = await getApprovalPolicy(orgId);

    const rows = view === "board" ? [] : await db
      .select({ id: purchaseOrders.id, number: purchaseOrders.number, date: purchaseOrders.date, total: purchaseOrders.totalAmount, status: purchaseOrders.status, supplier: suppliers.nameAr, approvedAt: purchaseOrders.approvedAt })
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

    // Returns linked to each order (stock returns from its receipts + money returns from its invoices) — shown as sub-rows.
    const retRows = ids.length
      ? await db.select({ id: purchaseReturns.id, number: purchaseReturns.number, date: purchaseReturns.date, status: purchaseReturns.status, poId: purchaseReturns.purchaseOrderId })
          .from(purchaseReturns)
          .where(and(eq(purchaseReturns.organizationId, orgId), inArray(purchaseReturns.purchaseOrderId, ids)))
          .orderBy(desc(purchaseReturns.date), desc(purchaseReturns.number))
      : [];
    const retIds = retRows.map((r) => r.id);
    const qtyRows = retIds.length
      ? await db.select({ rid: purchaseReturnLines.purchaseReturnId, qty: sql<string>`coalesce(sum(${purchaseReturnLines.quantity}),0)` })
          .from(purchaseReturnLines).where(inArray(purchaseReturnLines.purchaseReturnId, retIds)).groupBy(purchaseReturnLines.purchaseReturnId)
      : [];
    const qtyByRet = new Map(qtyRows.map((r) => [r.rid, Number(r.qty)]));
    const retsByPo = new Map<string, { id: string; number: string; date: Date; qty: number; status: string }[]>();
    for (const r of retRows) {
      if (!r.poId) continue;
      const list = retsByPo.get(r.poId) ?? [];
      list.push({ id: r.id, number: r.number, date: r.date, qty: qtyByRet.get(r.id) ?? 0, status: r.status });
      retsByPo.set(r.poId, list);
    }

    const tableRows = rows.map((r) => ({
      ...r,
      orderedQty: aggBy.get(r.id)?.ordered ?? 0, receivedQty: aggBy.get(r.id)?.received ?? 0,
      returned: (retsByPo.get(r.id) ?? []).some((x) => x.status === "POSTED"),
      returns: retsByPo.get(r.id) ?? [],
      poNeedsApproval: needsApproval(policy, { docType: "PURCHASE_ORDER", total: Number(r.total) }) != null,
      poApproved: !!r.approvedAt,
    }));

    const boardCards: KanbanCard[] = view === "board"
      ? (await db.select({ id: purchaseOrders.id, number: purchaseOrders.number, date: purchaseOrders.date, total: purchaseOrders.totalAmount, status: purchaseOrders.status, supplier: suppliers.nameAr })
          .from(purchaseOrders).leftJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId)).where(where)
          .orderBy(desc(purchaseOrders.date), desc(purchaseOrders.number)).limit(BOARD_LIMIT))
          .map((r) => ({
            id: r.id, column: r.status, title: r.number, subtitle: r.supplier, amount: money(Number(r.total ?? 0)),
            meta: day(r.date), href: `/purchases/orders/${encodeURIComponent(r.number)}`,
          }))
      : [];

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
    // Same filters, the other view.
    const viewHref = (v: "table" | "board") => {
      const u = new URLSearchParams(qs(1).slice(1));
      u.delete("page");
      if (v === "board") u.set("view", "board");
      const s = u.toString();
      return s ? `/purchases/orders?${s}` : "/purchases/orders";
    };

    return (
      <div className="space-y-6">
        <ErpPageHeader
          icon="ClipboardList"
          title="أوامر الشراء"
          subtitle={`${total} أمر`}
          action={
            <div className="flex flex-wrap gap-2">
              <div className="flex rounded-lg border p-0.5">
                {(["table", "board"] as const).map((v) => (
                  <Link key={v} href={viewHref(v)}
                    className={cn("flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm", view === v ? "bg-primary text-primary-foreground" : "hover:bg-accent")}>
                    <Icon name={v === "table" ? "List" : "Columns3"} className="size-4" />{v === "table" ? "جدول" : "كانبان"}
                  </Link>
                ))}
              </div>
              {canManage && <Button asChild><Link href="/purchases/orders/new"><Icon name="Plus" className="size-4" />أمر شراء</Link></Button>}
            </div>
          }
        />

        <div className="grid gap-4 sm:grid-cols-3">
          <Card><CardContent className="pt-6"><div className="text-sm text-muted-foreground">إجمالي القيمة</div><p className="mt-1 text-2xl font-bold tabular-nums">{money(totalValue)}</p></CardContent></Card>
          <Card><CardContent className="pt-6"><div className="text-sm text-muted-foreground">قيمة الأوامر المفتوحة</div><p className="mt-1 text-2xl font-bold tabular-nums text-amber-600">{money(openValue)}</p></CardContent></Card>
          <Card><CardContent className="pt-6"><div className="text-sm text-muted-foreground">قيمة المفوترة</div><p className="mt-1 text-2xl font-bold tabular-nums text-emerald-600">{money(invoicedValue)}</p></CardContent></Card>
        </div>

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
                {view === "board" && <input type="hidden" name="view" value="board" />}
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
                  {hasFilters && <Button type="button" variant="outline" asChild><Link href="/purchases/orders">مسح</Link></Button>}
                </div>
              </form>
            </details>

            {view === "board" ? (
              <>
                <OrdersKanban kind="purchase" cards={boardCards} canMove={canConfirm || canManage} />
                {boardCards.length >= BOARD_LIMIT && (
                  <p className="text-xs text-muted-foreground">بيعرض آخر {BOARD_LIMIT.toLocaleString("ar-EG-u-nu-latn")} أمر — ضيّق الفلاتر عشان توصل للأقدم.</p>
                )}
              </>
            ) : rows.length === 0 ? (
              <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">{hasFilters ? "لا توجد نتائج مطابقة." : "لا توجد أوامر شراء بعد."}</div>
            ) : (
              <>
                <PurchaseOrdersTable rows={tableRows} canConfirm={canConfirm} canCreate={canManage} />
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
