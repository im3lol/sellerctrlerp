import { and, asc, eq, gte, inArray, lte, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { requireErpModule } from "@/lib/erp/org";
import { db } from "@/lib/db";
import {
  purchaseOrders, purchaseOrderLines, purchaseReceipts, purchaseReceiptLines,
  purchaseInvoices, purchaseInvoiceLines, purchaseReturns, purchaseReturnLines, suppliers,
} from "@/db/schema";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Icon } from "@/components/icon";
import { ErpPageHeader } from "@/components/erp/page-header";
import { PurchasesLedgerTable, type LedgerRow } from "@/components/erp/purchases-ledger-table";

const PER_PAGE = 20;
const selectCls = "flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm";

const DOC_TYPES: [string, string][] = [
  ["ORDER", "أوامر الشراء"],
  ["RECEIPT", "إذون الاستلام"],
  ["INVOICE", "فواتير الشراء"],
  ["RETURN", "المرتجعات"],
];

type SP = { [k: string]: string | string[] | undefined };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const num = (v: string | null) => (v === null ? null : Number(v));

export default async function PurchasesLedgerPage({ searchParams }: { searchParams: Promise<SP> }) {
  const { orgId } = await requireErpModule("purchases.view");
  const sp = await searchParams;
  const fSupplier = one(sp.supplier);
  const fType = one(sp.type); // "" = all, else ORDER|RECEIPT|INVOICE|RETURN
  const from = one(sp.from);
  const to = one(sp.to);
  const page = Math.max(1, parseInt(one(sp.page) || "1", 10) || 1);

  const fromDate = from ? new Date(from) : null;
  const toDate = to ? new Date(to + "T23:59:59") : null;
  const want = (t: string) => !fType || fType === t;

  // ── Build a per-source conditions helper (org + supplier + date range) ──
  const dateConds = (col: PgColumn) => {
    const c: SQL[] = [];
    if (fromDate) c.push(gte(col, fromDate));
    if (toDate) c.push(lte(col, toDate));
    return c;
  };

  const supList = await db
    .select({ id: suppliers.id, nameAr: suppliers.nameAr })
    .from(suppliers)
    .where(eq(suppliers.organizationId, orgId))
    .orderBy(asc(suppliers.code));
  const supMap = new Map(supList.map((s) => [s.id, s.nameAr]));

  const rows: LedgerRow[] = [];

  // ── Purchase Orders ──
  if (want("ORDER")) {
    const conds = [eq(purchaseOrders.organizationId, orgId), ...dateConds(purchaseOrders.date)];
    if (fSupplier) conds.push(eq(purchaseOrders.supplierId, fSupplier));
    const list = await db
      .select({
        id: purchaseOrders.id, number: purchaseOrders.number, date: purchaseOrders.date,
        status: purchaseOrders.status, supplierId: purchaseOrders.supplierId,
        subtotal: purchaseOrders.subtotal, shipping: purchaseOrders.shippingAmount,
        discount: purchaseOrders.discountAmount, tax: purchaseOrders.taxAmount, total: purchaseOrders.totalAmount,
      })
      .from(purchaseOrders)
      .where(and(...conds));
    const ids = list.map((r) => r.id);
    const agg = ids.length
      ? await db.select({
          pid: purchaseOrderLines.purchaseOrderId,
          total: sql<string>`coalesce(sum(${purchaseOrderLines.quantity}),0)`,
          received: sql<string>`coalesce(sum(${purchaseOrderLines.receivedQty}),0)`,
        }).from(purchaseOrderLines)
          .where(inArray(purchaseOrderLines.purchaseOrderId, ids))
          .groupBy(purchaseOrderLines.purchaseOrderId)
      : [];
    const qm = new Map(agg.map((a) => [a.pid, a]));
    for (const r of list) {
      const q = qm.get(r.id);
      rows.push({
        id: `ORDER-${r.id}`, number: r.number, date: r.date,
        supplierName: supMap.get(r.supplierId) ?? "—", docType: "ORDER", status: r.status,
        qtyTotal: Number(q?.total ?? 0), qtyReceived: Number(q?.received ?? 0), qtyRejected: null,
        subtotal: num(r.subtotal), shipping: num(r.shipping), discount: num(r.discount),
        tax: num(r.tax), total: num(r.total), href: `/erp/purchases/orders/${r.number}`,
      });
    }
  }

  // ── Purchase Receipts (stock only — no money columns) ──
  if (want("RECEIPT")) {
    const conds = [eq(purchaseReceipts.organizationId, orgId), ...dateConds(purchaseReceipts.date)];
    if (fSupplier) conds.push(eq(purchaseReceipts.supplierId, fSupplier));
    const list = await db
      .select({
        id: purchaseReceipts.id, number: purchaseReceipts.number, date: purchaseReceipts.date,
        status: purchaseReceipts.status, supplierId: purchaseReceipts.supplierId,
      })
      .from(purchaseReceipts)
      .where(and(...conds));
    const ids = list.map((r) => r.id);
    const agg = ids.length
      ? await db.select({
          pid: purchaseReceiptLines.purchaseReceiptId,
          received: sql<string>`coalesce(sum(${purchaseReceiptLines.quantity}),0)`,
          rejected: sql<string>`coalesce(sum(${purchaseReceiptLines.rejectedQty}),0)`,
        }).from(purchaseReceiptLines)
          .where(inArray(purchaseReceiptLines.purchaseReceiptId, ids))
          .groupBy(purchaseReceiptLines.purchaseReceiptId)
      : [];
    const qm = new Map(agg.map((a) => [a.pid, a]));
    for (const r of list) {
      const q = qm.get(r.id);
      const recv = Number(q?.received ?? 0);
      const rej = Number(q?.rejected ?? 0);
      rows.push({
        id: `RECEIPT-${r.id}`, number: r.number, date: r.date,
        supplierName: (r.supplierId && supMap.get(r.supplierId)) || "—", docType: "RECEIPT", status: r.status,
        qtyTotal: recv + rej, qtyReceived: recv, qtyRejected: rej,
        subtotal: null, shipping: null, discount: null, tax: null, total: null,
        href: `/erp/purchases/receipts/${r.number}`,
      });
    }
  }

  // ── Purchase Invoices ──
  if (want("INVOICE")) {
    const conds = [eq(purchaseInvoices.organizationId, orgId), ...dateConds(purchaseInvoices.date)];
    if (fSupplier) conds.push(eq(purchaseInvoices.supplierId, fSupplier));
    const list = await db
      .select({
        id: purchaseInvoices.id, number: purchaseInvoices.number, date: purchaseInvoices.date,
        status: purchaseInvoices.status, supplierId: purchaseInvoices.supplierId,
        subtotal: purchaseInvoices.subtotal, shipping: purchaseInvoices.shippingAmount,
        discount: purchaseInvoices.discountAmount, tax: purchaseInvoices.taxAmount, total: purchaseInvoices.totalAmount,
      })
      .from(purchaseInvoices)
      .where(and(...conds));
    const ids = list.map((r) => r.id);
    const agg = ids.length
      ? await db.select({
          pid: purchaseInvoiceLines.purchaseInvoiceId,
          total: sql<string>`coalesce(sum(${purchaseInvoiceLines.quantity}),0)`,
        }).from(purchaseInvoiceLines)
          .where(inArray(purchaseInvoiceLines.purchaseInvoiceId, ids))
          .groupBy(purchaseInvoiceLines.purchaseInvoiceId)
      : [];
    const qm = new Map(agg.map((a) => [a.pid, a]));
    for (const r of list) {
      rows.push({
        id: `INVOICE-${r.id}`, number: r.number, date: r.date,
        supplierName: supMap.get(r.supplierId) ?? "—", docType: "INVOICE", status: r.status,
        qtyTotal: Number(qm.get(r.id)?.total ?? 0), qtyReceived: null, qtyRejected: null,
        subtotal: num(r.subtotal), shipping: num(r.shipping), discount: num(r.discount),
        tax: num(r.tax), total: num(r.total), href: `/erp/purchases/invoices/${r.number}`,
      });
    }
  }

  // ── Purchase Returns (debit notes — total only) ──
  if (want("RETURN")) {
    const conds = [eq(purchaseReturns.organizationId, orgId), ...dateConds(purchaseReturns.date)];
    if (fSupplier) conds.push(eq(purchaseReturns.supplierId, fSupplier));
    const list = await db
      .select({
        id: purchaseReturns.id, number: purchaseReturns.number, date: purchaseReturns.date,
        status: purchaseReturns.status, supplierId: purchaseReturns.supplierId, total: purchaseReturns.totalAmount,
      })
      .from(purchaseReturns)
      .where(and(...conds));
    const ids = list.map((r) => r.id);
    const agg = ids.length
      ? await db.select({
          pid: purchaseReturnLines.purchaseReturnId,
          total: sql<string>`coalesce(sum(${purchaseReturnLines.quantity}),0)`,
        }).from(purchaseReturnLines)
          .where(inArray(purchaseReturnLines.purchaseReturnId, ids))
          .groupBy(purchaseReturnLines.purchaseReturnId)
      : [];
    const qm = new Map(agg.map((a) => [a.pid, a]));
    for (const r of list) {
      rows.push({
        id: `RETURN-${r.id}`, number: r.number, date: r.date,
        supplierName: supMap.get(r.supplierId) ?? "—", docType: "RETURN", status: r.status,
        qtyTotal: Number(qm.get(r.id)?.total ?? 0), qtyReceived: null, qtyRejected: null,
        subtotal: null, shipping: null, discount: null, tax: null, total: num(r.total),
        href: `/erp/purchases/returns/${r.number}`,
      });
    }
  }

  // ── Sort newest-first, compute totals over the FULL filtered set, then paginate ──
  rows.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const totals = rows.reduce(
    (acc, r) => {
      acc.qtyTotal += r.qtyTotal ?? 0;
      acc.qtyReceived += r.qtyReceived ?? 0;
      acc.qtyRejected += r.qtyRejected ?? 0;
      acc.subtotal += r.subtotal ?? 0;
      acc.shipping += r.shipping ?? 0;
      acc.discount += r.discount ?? 0;
      acc.tax += r.tax ?? 0;
      acc.total += r.total ?? 0;
      return acc;
    },
    { qtyTotal: 0, qtyReceived: 0, qtyRejected: 0, subtotal: 0, shipping: 0, discount: 0, tax: 0, total: 0 },
  );

  const totalRows = rows.length;
  const pages = Math.max(1, Math.ceil(totalRows / PER_PAGE));
  const safePage = Math.min(page, pages);
  const pageRows = rows.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE);

  const hasFilters = Boolean(fSupplier || fType || from || to);
  const qs = (p: number) => {
    const u = new URLSearchParams();
    if (fSupplier) u.set("supplier", fSupplier);
    if (fType) u.set("type", fType);
    if (from) u.set("from", from);
    if (to) u.set("to", to);
    u.set("page", String(p));
    return `?${u.toString()}`;
  };

  return (
    <div className="space-y-6">
      <ErpPageHeader
        icon="BookOpen"
        title="تقرير دفتر المشتريات"
        subtitle={`${totalRows} حركة`}
      />
      <Card>
        <CardHeader>
          <CardTitle>دفتر المشتريات (Ledger)</CardTitle>
          <CardDescription>
            حصر شامل لكل حركات المشتريات — أوامر الشراء، إذون الاستلام، فواتير الشراء، والمرتجعات — مع تفصيل السعر والشحن والخصم والضريبة والإجمالي. استخدم الفلاتر لحصر مورد أو نوع وثيقة أو فترة زمنية.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <details open={hasFilters} className="rounded-lg border">
            <summary className="flex cursor-pointer select-none items-center gap-2 px-4 py-2 text-sm font-medium">
              <Icon name="ListFilter" className="size-4" /> بحث وتصفية
            </summary>
            <form className="grid gap-3 p-4 pt-0 sm:grid-cols-4 items-end">
              <div className="space-y-1">
                <Label htmlFor="supplier">المورد</Label>
                <select id="supplier" name="supplier" defaultValue={fSupplier} className={selectCls}>
                  <option value="">كل الموردين</option>
                  {supList.map((s) => <option key={s.id} value={s.id}>{s.nameAr}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="type">نوع الوثيقة</Label>
                <select id="type" name="type" defaultValue={fType} className={selectCls}>
                  <option value="">كل الأنواع</option>
                  {DOC_TYPES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div className="space-y-1"><Label htmlFor="from">من تاريخ</Label><Input id="from" name="from" type="date" defaultValue={from} /></div>
              <div className="space-y-1"><Label htmlFor="to">إلى تاريخ</Label><Input id="to" name="to" type="date" defaultValue={to} /></div>
              <div className="flex gap-2 sm:col-span-4">
                <Button type="submit">تطبيق</Button>
                {hasFilters && <Button type="button" variant="outline" asChild><a href="/erp/purchases/reports/ledger">مسح</a></Button>}
              </div>
            </form>
          </details>

          {totalRows === 0 ? (
            <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">
              {hasFilters ? "لا توجد حركات مطابقة." : "لا توجد حركات مشتريات بعد."}
            </div>
          ) : (
            <>
              <PurchasesLedgerTable rows={pageRows} totals={totals} />
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
