import Link from "next/link";
import { and, desc, eq, gte, ilike, lte, or, sql } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { journalEntries, journalEntryLines } from "@/db/schema";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Icon } from "@/components/icon";
import { ErpPageHeader } from "@/components/erp/page-header";
import { JournalTable } from "@/components/erp/journal-table";
import { selectCls } from "@/lib/utils";

const PAGE_SIZE = 20;
const SOURCE: Record<string, string> = {
  MANUAL: "قيد يدوي",
  SALES_INVOICE: "فاتورة بيع",
  PURCHASE_INVOICE: "فاتورة شراء",
  RECEIPT_VOUCHER: "سند قبض",
  PAYMENT_VOUCHER: "سند صرف",
  SALES_RETURN: "مرتجع مبيعات",
  PURCHASE_RETURN: "مرتجع مشتريات",
  REVERSAL: "قيد عكسي",
  STOCK_ADJUSTMENT: "تسوية مخزون",
  GOODS_RECEIPT: "استلام بضاعة",
  DELIVERY_COGS: "ت.ب.م تسليم",
  OPENING_BALANCE: "رصيد افتتاحي",
};
const SOURCE_FILTER = ["MANUAL", "SALES_INVOICE", "PURCHASE_INVOICE", "RECEIPT_VOUCHER", "PAYMENT_VOUCHER", "SALES_RETURN", "PURCHASE_RETURN", "REVERSAL", "STOCK_ADJUSTMENT"];

const num = (n: number) => n.toLocaleString("ar-EG-u-nu-latn");
const money = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type SP = { q?: string; status?: string; source?: string; from?: string; to?: string; page?: string };

export default async function JournalPage({ searchParams }: { searchParams: Promise<SP> }) {
  return loadErpPage("accounting.view", async ({ orgId, role, can }) => {
    const sp = await searchParams;
    const q = (sp.q ?? "").trim();
    const status = sp.status ?? "";
    const source = sp.source ?? "";
    const from = sp.from ?? "";
    const to = sp.to ?? "";
    const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);

    const conds = [eq(journalEntries.organizationId, orgId)];
    if (status) conds.push(eq(journalEntries.status, status));
    if (source) conds.push(eq(journalEntries.sourceType, source));
    if (from) conds.push(gte(journalEntries.date, new Date(from)));
    if (to) conds.push(lte(journalEntries.date, new Date(`${to}T23:59:59`)));
    if (q) {
      const like = `%${q}%`;
      conds.push(or(ilike(journalEntries.number, like), ilike(journalEntries.description, like))!);
    }
    const where = and(...conds);

    const [[{ count }], [sum], rows] = await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(journalEntries).where(where),
      // Filter-aware: posted value (Σ debit) + posted/draft entry counts.
      db.select({
        postedValue: sql<string>`coalesce(sum(${journalEntryLines.debit}) filter (where ${journalEntries.status} = 'POSTED'), 0)`,
        postedCount: sql<number>`count(distinct ${journalEntries.id}) filter (where ${journalEntries.status} = 'POSTED')`,
        draftCount: sql<number>`count(distinct ${journalEntries.id}) filter (where ${journalEntries.status} = 'DRAFT')`,
      }).from(journalEntries).leftJoin(journalEntryLines, eq(journalEntryLines.journalEntryId, journalEntries.id)).where(where),
      db
        .select({
          id: journalEntries.id,
          number: journalEntries.number,
          date: journalEntries.date,
          description: journalEntries.description,
          status: journalEntries.status,
          sourceType: journalEntries.sourceType,
          total: sql<string>`coalesce(sum(${journalEntryLines.debit}), 0)`,
        })
        .from(journalEntries)
        .leftJoin(journalEntryLines, eq(journalEntryLines.journalEntryId, journalEntries.id))
        .where(where)
        .groupBy(journalEntries.id)
        .orderBy(desc(journalEntries.date), desc(journalEntries.number))
        .limit(PAGE_SIZE)
        .offset((page - 1) * PAGE_SIZE),
    ]);

    const total = Number(count);
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const hasFilters = !!(q || status || source || from || to);

    const pageHref = (p: number) => {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (status) params.set("status", status);
      if (source) params.set("source", source);
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      params.set("page", String(p));
      return `/accounting/journal?${params.toString()}`;
    };

    return (
      <div className="space-y-6">
        <ErpPageHeader
          icon="BookText"
          title="القيود اليومية"
          subtitle={`${num(total)} قيد`}
          action={
            <div className="flex gap-2">
              {total > 0 && (
                <Button asChild variant="outline">
                  <a href={`/api/erp/accounting/journal/export?${new URLSearchParams({ q, status, source, from, to }).toString()}`}><Icon name="Download" className="size-4" />Excel</a>
                </Button>
              )}
              {can("accounting.create") && (
                <Button asChild>
                  <Link href="/accounting/journal/new"><Icon name="Plus" className="size-4" />قيد جديد</Link>
                </Button>
              )}
            </div>
          }
        />

        <div className="grid gap-4 sm:grid-cols-3">
          <Card><CardContent className="pt-6"><div className="text-sm text-muted-foreground">إجمالي القيمة المُرحّلة</div><p className="mt-1 text-2xl font-bold tabular-nums">{money(Number(sum?.postedValue ?? 0))}</p></CardContent></Card>
          <Card><CardContent className="pt-6"><div className="text-sm text-muted-foreground">قيود مُرحّلة</div><p className="mt-1 text-2xl font-bold tabular-nums text-emerald-600">{num(Number(sum?.postedCount ?? 0))}</p></CardContent></Card>
          <Card><CardContent className="pt-6"><div className="text-sm text-muted-foreground">مسودة (غير مُرحّلة)</div><p className={`mt-1 text-2xl font-bold tabular-nums ${Number(sum?.draftCount ?? 0) > 0 ? "text-amber-600" : ""}`}>{num(Number(sum?.draftCount ?? 0))}</p></CardContent></Card>
        </div>

        <Card>
          <details open={hasFilters} className="group">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 p-6 [&::-webkit-details-marker]:hidden">
              <div className="flex items-center gap-2">
                <Icon name="ListFilter" className="size-4 text-muted-foreground" />
                <span className="font-semibold">تصفية</span>
                {hasFilters && <Badge variant="secondary">مُفعّلة</Badge>}
              </div>
              <Icon name="ChevronDown" className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
            </summary>
            <div className="px-6 pb-6">
              <form className="flex flex-wrap items-end gap-3">
              <div className="space-y-2">
                <Label htmlFor="q">بحث</Label>
                <Input id="q" name="q" defaultValue={q} placeholder="رقم القيد أو البيان" className="min-w-56" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="status">الحالة</Label>
                <select id="status" name="status" defaultValue={status} className={`${selectCls} min-w-32`}>
                  <option value="">الكل</option>
                  <option value="POSTED">مرحّل</option>
                  <option value="DRAFT">مسودة</option>
                  <option value="REVERSED">معكوس</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="source">المصدر</Label>
                <select id="source" name="source" defaultValue={source} className={`${selectCls} min-w-40`}>
                  <option value="">الكل</option>
                  {SOURCE_FILTER.map((s) => <option key={s} value={s}>{SOURCE[s] ?? s}</option>)}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="from">من</Label>
                <input id="from" name="from" type="date" defaultValue={from} className={selectCls} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="to">إلى</Label>
                <input id="to" name="to" type="date" defaultValue={to} className={selectCls} />
              </div>
              <Button type="submit"><Icon name="Search" className="size-4" />تصفية</Button>
              {hasFilters && (
                <Button asChild variant="ghost"><Link href="/accounting/journal">مسح</Link></Button>
              )}
              </form>
            </div>
          </details>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>دفتر اليومية</CardTitle>
            <CardDescription>القيود المحاسبية للمؤسسة النشطة (تشمل المُرحّلة تلقائياً من المستندات).</CardDescription>
          </CardHeader>
          <CardContent>
            {rows.length === 0 ? (
              <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">
                {hasFilters ? "لا توجد قيود مطابقة للتصفية." : "لا توجد قيود بعد."}
              </div>
            ) : (
              <>
                <JournalTable rows={rows} canPost={can("accounting.post")} canCreate={can("accounting.create")} total={total} filter={{ q, status, source, from, to }} />

                <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
                  <span>صفحة {num(page)} من {num(pages)} · {num(total)} قيد</span>
                  <div className="flex gap-2">
                    <Button asChild variant="outline" size="sm" disabled={page <= 1} className={page <= 1 ? "pointer-events-none opacity-50" : ""}>
                      <Link href={pageHref(page - 1)}><Icon name="ChevronRight" className="size-4" />السابق</Link>
                    </Button>
                    <Button asChild variant="outline" size="sm" disabled={page >= pages} className={page >= pages ? "pointer-events-none opacity-50" : ""}>
                      <Link href={pageHref(page + 1)}>التالي<Icon name="ChevronLeft" className="size-4" /></Link>
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
