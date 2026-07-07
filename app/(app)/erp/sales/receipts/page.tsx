import Link from "next/link";
import { and, desc, eq, gte, ilike, lte, or, sql } from "drizzle-orm";
import { requireErpModule, erpCan } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { receiptVouchers, customers, salesInvoices } from "@/db/schema";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Icon } from "@/components/icon";
import { ErpPageHeader } from "@/components/erp/page-header";
import { FilterBar, filterFieldCls } from "@/components/erp/filter-bar";
import { Pagination } from "@/components/erp/pagination";
import { VoucherRowActions } from "@/components/erp/voucher-row-actions";

const PAGE_SIZE = 20;
const fmt = (v: string | null) => Number(v ?? 0).toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dt = (d: Date) => new Date(d).toLocaleDateString("en-GB", { year: "numeric", month: "2-digit", day: "2-digit" });
const METHOD: Record<string, string> = { CASH: "نقدي", BANK: "تحويل بنكي", CARD: "بطاقة", CHEQUE: "شيك" };

type SP = { q?: string; status?: string; method?: string; from?: string; to?: string; page?: string };

export default async function ReceiptsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const { orgId, role } = await requireErpModule("sales.view");
  const canManage = erpCan(role, "sales.collect");
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const status = sp.status ?? "";
  const method = sp.method ?? "";
  const from = sp.from ?? "";
  const to = sp.to ?? "";
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);

  const conds = [eq(receiptVouchers.organizationId, orgId)];
  if (status) conds.push(eq(receiptVouchers.status, status));
  if (method) conds.push(eq(receiptVouchers.paymentMethod, method));
  if (from) conds.push(gte(receiptVouchers.date, new Date(from)));
  if (to) conds.push(lte(receiptVouchers.date, new Date(`${to}T23:59:59`)));
  if (q) conds.push(or(ilike(receiptVouchers.number, `%${q}%`), ilike(customers.nameAr, `%${q}%`))!);
  const where = and(...conds);

  const base = db
    .select({
      id: receiptVouchers.id,
      number: receiptVouchers.number,
      date: receiptVouchers.date,
      amount: receiptVouchers.amount,
      method: receiptVouchers.paymentMethod,
      status: receiptVouchers.status,
      customer: customers.nameAr,
      invoice: salesInvoices.number,
    })
    .from(receiptVouchers)
    .leftJoin(customers, eq(customers.id, receiptVouchers.customerId))
    .leftJoin(salesInvoices, eq(salesInvoices.id, receiptVouchers.salesInvoiceId));

  const [[{ count }], [{ posted }], rows] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(receiptVouchers).leftJoin(customers, eq(customers.id, receiptVouchers.customerId)).where(where),
    db.select({ posted: sql<string>`coalesce(sum(${receiptVouchers.amount}) filter (where ${receiptVouchers.status} = 'POSTED'), 0)` }).from(receiptVouchers).leftJoin(customers, eq(customers.id, receiptVouchers.customerId)).where(where),
    base.where(where).orderBy(desc(receiptVouchers.date), desc(receiptVouchers.number)).limit(PAGE_SIZE).offset((page - 1) * PAGE_SIZE),
  ]);

  const total = Number(count);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilters = !!(q || status || method || from || to);

  return (
    <div className="space-y-6">
      <ErpPageHeader
        icon="HandCoins"
        title="سندات القبض"
        subtitle={`${total.toLocaleString("ar-EG-u-nu-latn")} سند — محصّل (مرحّل) ${fmt(posted)}`}
        action={
          erpCan(role, "sales.collect") ? (
            <Button asChild>
              <Link href="/erp/sales/receipts/new"><Icon name="Plus" className="size-4" />سند قبض</Link>
            </Button>
          ) : undefined
        }
      />

      <FilterBar active={hasFilters} clearHref="/erp/sales/receipts">
        <div className="space-y-2">
          <Label htmlFor="q">بحث</Label>
          <Input id="q" name="q" defaultValue={q} placeholder="رقم السند أو العميل" className="min-w-56" />
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
          <CardTitle>التحصيلات</CardTitle>
          <CardDescription>سندات قبض من العملاء (Dr نقدية/بنك · Cr العملاء).</CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">
              {hasFilters ? "لا توجد سندات مطابقة للتصفية." : "لا توجد سندات قبض بعد."}
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-start">الرقم</TableHead>
                    <TableHead className="text-start">التاريخ</TableHead>
                    <TableHead className="text-start">العميل</TableHead>
                    <TableHead className="text-start">الفاتورة</TableHead>
                    <TableHead className="text-start">الطريقة</TableHead>
                    <TableHead className="text-start">المبلغ</TableHead>
                    <TableHead className="text-start">الحالة</TableHead>
                    <TableHead />
                    {canManage && <TableHead className="text-start">إجراءات</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono">{r.number}</TableCell>
                      <TableCell>{dt(r.date)}</TableCell>
                      <TableCell>{r.customer ?? "—"}</TableCell>
                      <TableCell className="font-mono">{r.invoice ? <Link href={`/erp/sales/invoices/${encodeURIComponent(r.invoice)}`} className="text-primary hover:underline">{r.invoice}</Link> : "تحت الحساب"}</TableCell>
                      <TableCell>{METHOD[r.method] ?? r.method}</TableCell>
                      <TableCell>{fmt(r.amount)}</TableCell>
                      <TableCell><Badge variant={r.status === "POSTED" ? "default" : "secondary"}>{r.status === "POSTED" ? "مرحّل" : "مسودة"}</Badge></TableCell>
                      <TableCell>
                        <Button size="icon" variant="ghost" asChild>
                          <a href={`/erp/sales/receipts/${encodeURIComponent(r.number)}/print`} target="_blank" rel="noopener" title="طباعة">
                            <Icon name="Printer" className="size-4" />
                          </a>
                        </Button>
                      </TableCell>
                      {canManage && <TableCell><VoucherRowActions voucherId={r.id} type="receipt" status={r.status} canManage={canManage} /></TableCell>}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Pagination page={page} pages={pages} total={total} unit="سند" basePath="/erp/sales/receipts" params={{ q, status, method, from, to }} />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
