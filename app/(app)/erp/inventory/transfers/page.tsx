import Link from "next/link";
import { and, count, desc, eq, gte, ilike, inArray, lte, sql } from "drizzle-orm";
import { requireErpModule, erpCan } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { stockTransfers, stockTransferLines } from "@/db/schema";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Icon } from "@/components/icon";
import { ErpPageHeader } from "@/components/erp/page-header";

const PER_PAGE = 10;
const selectCls = "flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm";
const intl = (n: number) => n.toLocaleString("ar-EG-u-nu-latn");
const dt = (d: Date) => new Date(d).toLocaleDateString("ar-EG-u-nu-latn", { year: "numeric", month: "2-digit", day: "2-digit" });

const STATUS_OPTIONS: [string, string][] = [["DRAFT", "مسودة"], ["POSTED", "مرحّل"]];

type SP = { [k: string]: string | string[] | undefined };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function TransfersPage({ searchParams }: { searchParams: Promise<SP> }) {
  const { orgId, role } = await requireErpModule("inventory.view");
  const canManage = erpCan(role, "inventory.create");
  const sp = await searchParams;
  const q = one(sp.q).trim();
  const fStatus = one(sp.status);
  const from = one(sp.from);
  const to = one(sp.to);
  const page = Math.max(1, parseInt(one(sp.page) || "1", 10) || 1);

  const conds = [eq(stockTransfers.organizationId, orgId)];
  if (q) conds.push(ilike(stockTransfers.number, `%${q}%`));
  if (fStatus) conds.push(eq(stockTransfers.status, fStatus));
  if (from) conds.push(gte(stockTransfers.date, new Date(from)));
  if (to) conds.push(lte(stockTransfers.date, new Date(to + "T23:59:59")));
  const where = and(...conds);

  const [{ total }] = await db.select({ total: count() }).from(stockTransfers).where(where);
  const pages = Math.max(1, Math.ceil(Number(total) / PER_PAGE));
  const safePage = Math.min(page, pages);

  const heads = await db
    .select({ id: stockTransfers.id, number: stockTransfers.number, date: stockTransfers.date, notes: stockTransfers.notes, status: stockTransfers.status })
    .from(stockTransfers)
    .where(where)
    .orderBy(desc(stockTransfers.date), desc(stockTransfers.number))
    .limit(PER_PAGE)
    .offset((safePage - 1) * PER_PAGE);

  const ids = heads.map((h) => h.id);
  const agg = ids.length
    ? await db.select({ tid: stockTransferLines.stockTransferId, c: count() }).from(stockTransferLines)
        .where(inArray(stockTransferLines.stockTransferId, ids)).groupBy(stockTransferLines.stockTransferId)
    : [];
  const aggMap = new Map(agg.map((a) => [a.tid, a]));

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
        icon="ArrowLeftRight"
        title="التحويلات المخزنية"
        subtitle={`${total} تحويل`}
        action={
          canManage ? (
            <Button asChild>
              <Link href="/erp/inventory/transfers/new"><Icon name="Plus" className="size-4" />تحويل جديد</Link>
            </Button>
          ) : undefined
        }
      />
      <Card>
        <CardHeader>
          <CardTitle>سجل التحويلات</CardTitle>
          <CardDescription>نقل البضاعة بين المستودعات بنفس التكلفة (لا يؤثّر على إجمالي قيمة المخزون). تُحفظ مسودة ثم تُؤكَّد.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <details open={hasFilters} className="rounded-lg border">
            <summary className="flex cursor-pointer select-none items-center gap-2 px-4 py-2 text-sm font-medium">
              <Icon name="ListFilter" className="size-4" /> بحث وتصفية
            </summary>
            <form className="grid gap-3 p-4 pt-0 sm:grid-cols-4 items-end">
              <div className="space-y-1"><Label htmlFor="q">رقم التحويل</Label><Input id="q" name="q" defaultValue={q} placeholder="TR-2026-..." /></div>
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
                {hasFilters && <Button type="button" variant="outline" asChild><a href="/erp/inventory/transfers">مسح</a></Button>}
              </div>
            </form>
          </details>

          {heads.length === 0 ? (
            <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">{hasFilters ? "لا توجد تحويلات مطابقة." : "لا توجد تحويلات بعد."}</div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-start">الرقم</TableHead>
                    <TableHead className="text-start">التاريخ</TableHead>
                    <TableHead className="text-start">عدد الأصناف</TableHead>
                    <TableHead className="text-start">ملاحظات</TableHead>
                    <TableHead className="text-start">الحالة</TableHead>
                    <TableHead className="text-start"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {heads.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell><Link href={`/erp/inventory/transfers/${r.id}`} className="font-mono hover:text-primary">{r.number}</Link></TableCell>
                      <TableCell className="whitespace-nowrap">{dt(r.date)}</TableCell>
                      <TableCell>{intl(Number(aggMap.get(r.id)?.c ?? 0))}</TableCell>
                      <TableCell className="max-w-[200px] truncate text-muted-foreground">{r.notes ?? "—"}</TableCell>
                      <TableCell><Badge variant={r.status === "POSTED" ? "default" : "secondary"}>{r.status === "POSTED" ? "مرحّل" : "مسودة"}</Badge></TableCell>
                      <TableCell>
                        <Link href={`/erp/inventory/transfers/${r.id}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary">
                          {r.status === "DRAFT" ? "مراجعة وتأكيد" : "عرض"}<Icon name="ChevronLeft" className="size-4" />
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
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
