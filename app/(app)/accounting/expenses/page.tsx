import Link from "next/link";
import { aliasedTable, and, desc, eq, gte, ilike, lte, or, sql } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { expenses, accounts } from "@/db/schema";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Icon } from "@/components/icon";
import { ErpPageHeader } from "@/components/erp/page-header";
import { FilterBar, filterFieldCls } from "@/components/erp/filter-bar";
import { Pagination } from "@/components/erp/pagination";
import { ExpensesTable } from "@/components/erp/expenses-table";

const PAGE_SIZE = 20;
const fmt = (v: string | null) => Number(v ?? 0).toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type SP = { q?: string; status?: string; from?: string; to?: string; page?: string };

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<SP> }) {
  return loadErpPage("accounting.view", async ({ orgId, can }) => {
    const canManage = can("accounting.create");
    const sp = await searchParams;
    const q = (sp.q ?? "").trim();
    const status = sp.status ?? "";
    const from = sp.from ?? "";
    const to = sp.to ?? "";
    const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);

    const cat = aliasedTable(accounts, "cat");
    const cash = aliasedTable(accounts, "cash");

    const conds = [eq(expenses.organizationId, orgId)];
    if (status) conds.push(eq(expenses.status, status));
    if (from) conds.push(gte(expenses.date, new Date(from)));
    if (to) conds.push(lte(expenses.date, new Date(`${to}T23:59:59`)));
    if (q) conds.push(or(ilike(expenses.number, `%${q}%`), ilike(expenses.payee, `%${q}%`), ilike(cat.nameAr, `%${q}%`))!);
    const where = and(...conds);

    const base = db
      .select({
        id: expenses.id, number: expenses.number, date: expenses.date, amount: expenses.amount,
        status: expenses.status, payee: expenses.payee, category: cat.nameAr, paidFrom: cash.nameAr,
      })
      .from(expenses)
      .leftJoin(cat, eq(cat.id, expenses.expenseAccountId))
      .leftJoin(cash, eq(cash.id, expenses.cashAccountId));

    const [[{ count }], [sums], rows] = await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(expenses).leftJoin(cat, eq(cat.id, expenses.expenseAccountId)).where(where),
      db.select({
        posted: sql<string>`coalesce(sum(${expenses.amount}) filter (where ${expenses.status} = 'POSTED'), 0)`,
        draft: sql<string>`coalesce(sum(${expenses.amount}) filter (where ${expenses.status} = 'DRAFT'), 0)`,
      }).from(expenses).leftJoin(cat, eq(cat.id, expenses.expenseAccountId)).where(where),
      base.where(where).orderBy(desc(expenses.date), desc(expenses.number)).limit(PAGE_SIZE).offset((page - 1) * PAGE_SIZE),
    ]);
    const postedValue = Number(sums?.posted ?? 0);
    const draftValue = Number(sums?.draft ?? 0);

    const total = Number(count);
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const hasFilters = !!(q || status || from || to);

    return (
      <div className="space-y-6">
        <ErpPageHeader
          icon="Wallet"
          title="المصروفات"
          subtitle={`${total.toLocaleString("ar-EG-u-nu-latn")} مصروف`}
          action={
            <div className="flex gap-2">
              <Button variant="outline" asChild><Link href="/accounting/expenses/recurring"><Icon name="Repeat" className="size-4" />المتكررة</Link></Button>
              {canManage && <Button asChild><Link href="/accounting/expenses/new"><Icon name="Plus" className="size-4" />مصروف جديد</Link></Button>}
            </div>
          }
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Card><CardContent className="pt-6"><div className="text-sm text-muted-foreground">المصروفات المُرحّلة</div><p className="mt-1 text-2xl font-bold tabular-nums">{fmt(String(postedValue))}</p></CardContent></Card>
          <Card><CardContent className="pt-6"><div className="text-sm text-muted-foreground">مسودة (غير مُرحّلة)</div><p className={`mt-1 text-2xl font-bold tabular-nums ${draftValue > 0 ? "text-amber-600" : ""}`}>{fmt(String(draftValue))}</p></CardContent></Card>
        </div>

        <FilterBar active={hasFilters} clearHref="/accounting/expenses">
          <div className="space-y-2">
            <Label htmlFor="q">بحث</Label>
            <Input id="q" name="q" defaultValue={q} placeholder="الرقم أو البند أو المستفيد" className="min-w-56" />
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
            <CardTitle>المصروفات التشغيلية</CardTitle>
            <CardDescription>مصروفات عامة تُدفع من النقدية/البنك (Dr المصروف · Cr نقدية/بنك).</CardDescription>
          </CardHeader>
          <CardContent>
            {rows.length === 0 ? (
              <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">
                {hasFilters ? "لا توجد مصروفات مطابقة للتصفية." : "لا توجد مصروفات بعد."}
              </div>
            ) : (
              <>
                <ExpensesTable rows={rows} canDelete={canManage} />
                <Pagination page={page} pages={pages} total={total} unit="مصروف" basePath="/accounting/expenses" params={{ q, status, from, to }} />
              </>
            )}
          </CardContent>
        </Card>
      </div>
    );
  });
}
