import Link from "next/link";
import { and, count, desc, eq, gte, ilike, inArray, lte, sql } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { stockAdjustments, stockAdjustmentLines } from "@/db/schema";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Icon } from "@/components/icon";
import { ErpPageHeader } from "@/components/erp/page-header";
import { AdjustmentsTable } from "@/components/erp/adjustments-table";
import { selectCls } from "@/lib/utils";

const PER_PAGE = 10;

const STATUS_OPTIONS: [string, string][] = [["DRAFT", "مسودة"], ["POSTED", "مرحّل"]];

type SP = { [k: string]: string | string[] | undefined };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function AdjustmentsPage({ searchParams }: { searchParams: Promise<SP> }) {
  return loadErpPage("inventory.view", async ({ orgId, role, can }) => {
    const canManage = can("inventory.create");
    const sp = await searchParams;
    const q = one(sp.q).trim();
    const fStatus = one(sp.status);
    const from = one(sp.from);
    const to = one(sp.to);
    const page = Math.max(1, parseInt(one(sp.page) || "1", 10) || 1);

    const conds = [eq(stockAdjustments.organizationId, orgId)];
    if (q) conds.push(ilike(stockAdjustments.number, `%${q}%`));
    if (fStatus) conds.push(eq(stockAdjustments.status, fStatus));
    if (from) conds.push(gte(stockAdjustments.date, new Date(from)));
    if (to) conds.push(lte(stockAdjustments.date, new Date(to + "T23:59:59")));
    const where = and(...conds);

    const [{ total }] = await db.select({ total: count() }).from(stockAdjustments).where(where);
    const pages = Math.max(1, Math.ceil(Number(total) / PER_PAGE));
    const safePage = Math.min(page, pages);

    const heads = await db
      .select({
        id: stockAdjustments.id, number: stockAdjustments.number, date: stockAdjustments.date,
        totalValue: stockAdjustments.totalValue, reason: stockAdjustments.reason, status: stockAdjustments.status,
      })
      .from(stockAdjustments)
      .where(where)
      .orderBy(desc(stockAdjustments.date), desc(stockAdjustments.createdAt))
      .limit(PER_PAGE)
      .offset((safePage - 1) * PER_PAGE);

    const ids = heads.map((h) => h.id);
    const agg = ids.length
      ? await db
          .select({ aid: stockAdjustmentLines.stockAdjustmentId, c: count(), delta: sql<string>`coalesce(sum(${stockAdjustmentLines.deltaQuantity}),0)` })
          .from(stockAdjustmentLines)
          .where(inArray(stockAdjustmentLines.stockAdjustmentId, ids))
          .groupBy(stockAdjustmentLines.stockAdjustmentId)
      : [];
    const aggMap = new Map(agg.map((a) => [a.aid, a]));

    const hasFilters = Boolean(q || fStatus || from || to);
    const qs = (p: number) => {
      const u = new URLSearchParams();
      if (q) u.set("q", q);
      if (fStatus) u.set("status", fStatus);
      if (from) u.set("from", from);
      if (to) u.set("to", to);
      u.set("page", String(p));
      return `?${u.toString()}`;
    };

    return (
      <div className="space-y-6">
        <ErpPageHeader
          icon="ClipboardCheck"
          title="تسويات المخزون"
          subtitle={`${total} تسوية`}
          action={
            canManage ? (
              <Button asChild>
                <Link href="/erp/inventory/adjustments/new"><Icon name="Plus" className="size-4" />تسوية جديدة</Link>
              </Button>
            ) : undefined
          }
        />
        <Card>
          <CardHeader>
            <CardTitle>سجل التسويات</CardTitle>
            <CardDescription>فروقات الجرد والتالف والفاقد (متعددة الأصناف). تُحفظ كمسودة ثم تُؤكَّد لتمرّ من دفتر المخزون + قيد محاسبي.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <details open={hasFilters} className="rounded-lg border">
              <summary className="flex cursor-pointer select-none items-center gap-2 px-4 py-2 text-sm font-medium">
                <Icon name="ListFilter" className="size-4" /> بحث وتصفية
              </summary>
              <form className="grid gap-3 p-4 pt-0 sm:grid-cols-4 items-end">
                <div className="space-y-1"><Label htmlFor="q">رقم التسوية</Label><Input id="q" name="q" defaultValue={q} placeholder="AJ-2026-..." /></div>
                <div className="space-y-1">
                  <Label htmlFor="status">الحالة</Label>
                  <select id="status" name="status" defaultValue={fStatus} className={selectCls}>
                    <option value="">الكل</option>
                    {STATUS_OPTIONS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div className="space-y-1"><Label htmlFor="from">من تاريخ</Label><Input id="from" name="from" type="date" defaultValue={from} /></div>
                <div className="space-y-1"><Label htmlFor="to">إلى تاريخ</Label><Input id="to" name="to" type="date" defaultValue={to} /></div>
                <div className="flex gap-2 sm:col-span-4">
                  <Button type="submit">تطبيق</Button>
                  {hasFilters && <Button type="button" variant="outline" asChild><Link href="/erp/inventory/adjustments">مسح</Link></Button>}
                </div>
              </form>
            </details>

            {heads.length === 0 ? (
              <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">{hasFilters ? "لا توجد تسويات مطابقة." : "لا توجد تسويات بعد."}</div>
            ) : (
              <>
                <AdjustmentsTable
                  canManage={can("inventory.confirm") || can("inventory.create")}
                  rows={heads.map((r) => {
                    const a = aggMap.get(r.id);
                    return { ...r, count: Number(a?.c ?? 0), delta: Number(a?.delta ?? 0) };
                  })}
                />
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
