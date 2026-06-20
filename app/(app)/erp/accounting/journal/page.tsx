import Link from "next/link";
import { and, desc, eq, gte, ilike, lte, or, sql } from "drizzle-orm";
import { requireErpModule, erpCan } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { journalEntries, journalEntryLines } from "@/db/schema";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Icon } from "@/components/icon";
import { ErpPageHeader } from "@/components/erp/page-header";

const PAGE_SIZE = 20;
const STATUS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" }> = {
  DRAFT: { label: "مسودة", variant: "secondary" },
  POSTED: { label: "مرحّل", variant: "default" },
  REVERSED: { label: "معكوس", variant: "destructive" },
};
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

const fmt = (v: string | null) => Number(v ?? 0).toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dt = (d: Date) => new Date(d).toLocaleDateString("en-GB", { year: "numeric", month: "2-digit", day: "2-digit" });
const num = (n: number) => n.toLocaleString("ar-EG-u-nu-latn");
const selectCls = "flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm";

type SP = { q?: string; status?: string; source?: string; from?: string; to?: string; page?: string };

export default async function JournalPage({ searchParams }: { searchParams: Promise<SP> }) {
  const { orgId, role } = await requireErpModule("accounting.view");
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

  const [[{ count }], rows] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(journalEntries).where(where),
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
    return `/erp/accounting/journal?${params.toString()}`;
  };

  return (
    <div className="space-y-6">
      <ErpPageHeader
        icon="BookText"
        title="القيود اليومية"
        subtitle={`${num(total)} قيد`}
        action={
          erpCan(role, "accounting.create") ? (
            <Button asChild>
              <Link href="/erp/accounting/journal/new"><Icon name="Plus" className="size-4" />قيد جديد</Link>
            </Button>
          ) : undefined
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>تصفية</CardTitle>
          <CardDescription>ابحث وصفِّ القيود حسب الحالة والمصدر والفترة.</CardDescription>
        </CardHeader>
        <CardContent>
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
              <Button asChild variant="ghost"><Link href="/erp/accounting/journal">مسح</Link></Button>
            )}
          </form>
        </CardContent>
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
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-start">الرقم</TableHead>
                    <TableHead className="text-start">التاريخ</TableHead>
                    <TableHead className="text-start">البيان</TableHead>
                    <TableHead className="text-start">المصدر</TableHead>
                    <TableHead className="text-start">المبلغ</TableHead>
                    <TableHead className="text-start">الحالة</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    const st = STATUS[r.status] ?? { label: r.status, variant: "secondary" as const };
                    return (
                      <TableRow key={r.id} className="hover:bg-muted/50">
                        <TableCell className="font-mono">
                          <Link href={`/erp/accounting/journal/${r.id}`} className="text-primary hover:underline">{r.number}</Link>
                        </TableCell>
                        <TableCell>{dt(r.date)}</TableCell>
                        <TableCell className="max-w-72 truncate">{r.description ?? "—"}</TableCell>
                        <TableCell className="text-muted-foreground">{SOURCE[r.sourceType ?? ""] ?? "—"}</TableCell>
                        <TableCell className="tabular-nums">{fmt(r.total)}</TableCell>
                        <TableCell><Badge variant={st.variant}>{st.label}</Badge></TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>

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
}
