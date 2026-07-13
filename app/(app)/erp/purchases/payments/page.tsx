import Link from "next/link";
import { and, desc, eq, gte, ilike, lte, or, sql } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { paymentVouchers, suppliers, purchaseInvoices } from "@/db/schema";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Icon } from "@/components/icon";
import { ErpPageHeader } from "@/components/erp/page-header";
import { FilterBar, filterFieldCls } from "@/components/erp/filter-bar";
import { Pagination } from "@/components/erp/pagination";
import { VouchersTable } from "@/components/erp/vouchers-table";

const PAGE_SIZE = 20;
const fmt = (v: string | null) => Number(v ?? 0).toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const METHOD: Record<string, string> = { CASH: "نقدي", BANK: "تحويل بنكي", CARD: "بطاقة", CHEQUE: "شيك" };

type SP = { q?: string; status?: string; method?: string; from?: string; to?: string; page?: string };

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const { orgId, role, can } = await requireErpModule("purchases.view");
  const canManage = can("purchases.pay");
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const status = sp.status ?? "";
  const method = sp.method ?? "";
  const from = sp.from ?? "";
  const to = sp.to ?? "";
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);

  const conds = [eq(paymentVouchers.organizationId, orgId)];
  if (status) conds.push(eq(paymentVouchers.status, status));
  if (method) conds.push(eq(paymentVouchers.paymentMethod, method));
  if (from) conds.push(gte(paymentVouchers.date, new Date(from)));
  if (to) conds.push(lte(paymentVouchers.date, new Date(`${to}T23:59:59`)));
  if (q) conds.push(or(ilike(paymentVouchers.number, `%${q}%`), ilike(suppliers.nameAr, `%${q}%`))!);
  const where = and(...conds);

  const base = db
    .select({
      id: paymentVouchers.id,
      number: paymentVouchers.number,
      date: paymentVouchers.date,
      amount: paymentVouchers.amount,
      method: paymentVouchers.paymentMethod,
      status: paymentVouchers.status,
      supplier: suppliers.nameAr,
      invoice: purchaseInvoices.number,
    })
    .from(paymentVouchers)
    .leftJoin(suppliers, eq(suppliers.id, paymentVouchers.supplierId))
    .leftJoin(purchaseInvoices, eq(purchaseInvoices.id, paymentVouchers.purchaseInvoiceId));

  const [[{ count }], [{ posted }], rows] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(paymentVouchers).leftJoin(suppliers, eq(suppliers.id, paymentVouchers.supplierId)).where(where),
    db.select({ posted: sql<string>`coalesce(sum(${paymentVouchers.amount}) filter (where ${paymentVouchers.status} = 'POSTED'), 0)` }).from(paymentVouchers).leftJoin(suppliers, eq(suppliers.id, paymentVouchers.supplierId)).where(where),
    base.where(where).orderBy(desc(paymentVouchers.date), desc(paymentVouchers.number)).limit(PAGE_SIZE).offset((page - 1) * PAGE_SIZE),
  ]);

  const total = Number(count);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilters = !!(q || status || method || from || to);

  return (
    <div className="space-y-6">
      <ErpPageHeader
        icon="Banknote"
        title="سندات الصرف"
        subtitle={`${total.toLocaleString("ar-EG-u-nu-latn")} سند — مدفوع (مرحّل) ${fmt(posted)}`}
        action={
          can("purchases.pay") ? (
            <Button asChild>
              <Link href="/erp/purchases/payments/new"><Icon name="Plus" className="size-4" />سند صرف</Link>
            </Button>
          ) : undefined
        }
      />

      <FilterBar active={hasFilters} clearHref="/erp/purchases/payments">
        <div className="space-y-2">
          <Label htmlFor="q">بحث</Label>
          <Input id="q" name="q" defaultValue={q} placeholder="رقم السند أو المورد" className="min-w-56" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="status">الحالة</Label>
          <select id="status" name="status" defaultValue={status} className={`${filterFieldCls} min-w-32`}>
            <option value="">الكل</option>
            <option value="POSTED">مرحّل</option>
            <option value="DRAFT">مسودة</option>
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="method">الطريقة</Label>
          <select id="method" name="method" defaultValue={method} className={`${filterFieldCls} min-w-32`}>
            <option value="">الكل</option>
            {Object.entries(METHOD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="from">من</Label>
          <input id="from" name="from" type="date" defaultValue={from} className={filterFieldCls} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="to">إلى</Label>
          <input id="to" name="to" type="date" defaultValue={to} className={filterFieldCls} />
        </div>
      </FilterBar>

      <Card>
        <CardHeader>
          <CardTitle>المدفوعات</CardTitle>
          <CardDescription>سندات صرف للموردين (Dr الموردون · Cr نقدية/بنك).</CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">
              {hasFilters ? "لا توجد سندات مطابقة للتصفية." : "لا توجد سندات صرف بعد."}
            </div>
          ) : (
            <>
              <VouchersTable
                type="payment"
                canManage={canManage}
                rows={rows.map((r) => ({ id: r.id, number: r.number, date: r.date, party: r.supplier, invoice: r.invoice, method: r.method, amount: r.amount, status: r.status }))}
              />
              <Pagination page={page} pages={pages} total={total} unit="سند" basePath="/erp/purchases/payments" params={{ q, status, method, from, to }} />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
