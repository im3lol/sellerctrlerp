import { and, desc, eq, ilike, sql, count } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { auditLogs, users } from "@/db/schema";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Icon } from "@/components/icon";
import { ErpPageHeader } from "@/components/erp/page-header";

const PER_PAGE = 20;
const selectCls = "flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm";
const dt = (d: Date) => new Date(d).toLocaleString("en-GB", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });

const ACTION: Record<string, { ar: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  CREATE: { ar: "إنشاء", variant: "secondary" },
  CONFIRM: { ar: "تأكيد", variant: "default" },
  POST: { ar: "ترحيل", variant: "default" },
  CONVERT: { ar: "تحويل", variant: "outline" },
  CANCEL: { ar: "إلغاء", variant: "destructive" },
  REVERSE: { ar: "عكس", variant: "destructive" },
  DELETE: { ar: "حذف", variant: "destructive" },
  UPDATE: { ar: "تعديل", variant: "secondary" },
};
const ENTITY: Record<string, string> = {
  SALES_ORDER: "أمر بيع", PURCHASE_ORDER: "أمر شراء",
  SALES_INVOICE: "فاتورة بيع", PURCHASE_INVOICE: "فاتورة شراء",
  RECEIPT_VOUCHER: "سند قبض", PAYMENT_VOUCHER: "سند صرف",
  SALES_RETURN: "مرتجع مبيعات", PURCHASE_RETURN: "مرتجع مشتريات",
  STOCK_TRANSFER: "تحويل مخزني", STOCK_ADJUSTMENT: "تسوية مخزون",
  DELIVERY_NOTE: "إذن صرف", GOODS_RECEIPT: "إذن استلام",
  JOURNAL_ENTRY: "قيد يومية",
};

type SP = { [k: string]: string | string[] | undefined };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function AuditLogPage({ searchParams }: { searchParams: Promise<SP> }) {
  const { orgId } = await requireErpModule("settings.view");
  const sp = await searchParams;
  const fAction = one(sp.action);
  const fEntity = one(sp.entity);
  const q = one(sp.q).trim();
  const page = Math.max(1, parseInt(one(sp.page) || "1", 10) || 1);

  const conds = [eq(auditLogs.organizationId, orgId)];
  if (fAction) conds.push(eq(auditLogs.action, fAction));
  if (fEntity) conds.push(eq(auditLogs.entityType, fEntity));
  if (q) conds.push(ilike(auditLogs.entityNumber, `%${q}%`));
  const where = and(...conds);

  const [{ total }] = await db.select({ total: count() }).from(auditLogs).where(where);
  const pages = Math.max(1, Math.ceil(Number(total) / PER_PAGE));
  const safePage = Math.min(page, pages);

  const rows = await db
    .select({
      id: auditLogs.id,
      createdAt: auditLogs.createdAt,
      action: auditLogs.action,
      entityType: auditLogs.entityType,
      entityNumber: auditLogs.entityNumber,
      summary: auditLogs.summary,
      userName: users.name,
    })
    .from(auditLogs)
    .leftJoin(users, sql`${users.id} = ${auditLogs.userId}::uuid`)
    .where(where)
    .orderBy(desc(auditLogs.createdAt))
    .limit(PER_PAGE)
    .offset((safePage - 1) * PER_PAGE);

  const qs = (p: number) => {
    const u = new URLSearchParams();
    if (fAction) u.set("action", fAction);
    if (fEntity) u.set("entity", fEntity);
    if (q) u.set("q", q);
    u.set("page", String(p));
    return `?${u.toString()}`;
  };
  const hasFilters = Boolean(fAction || fEntity || q);

  return (
    <div className="space-y-6">
      <ErpPageHeader icon="ScrollText" title="سجل التدقيق" subtitle={`${total} حدث`} />
      <Card>
        <CardHeader>
          <CardTitle>أحداث المستندات</CardTitle>
          <CardDescription>سجل غير قابل للتعديل لكل إنشاء/تأكيد/ترحيل/إلغاء/عكس على مستندات المؤسسة.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <details open={hasFilters} className="rounded-lg border">
            <summary className="cursor-pointer select-none px-4 py-2 text-sm font-medium flex items-center gap-2">
              <Icon name="ListFilter" className="size-4" /> التصفية
            </summary>
            <form className="grid gap-3 p-4 pt-0 sm:grid-cols-4 items-end">
              <div className="space-y-1">
                <Label htmlFor="q">رقم المستند</Label>
                <Input id="q" name="q" defaultValue={q} placeholder="SO-2026-..." />
              </div>
              <div className="space-y-1">
                <Label htmlFor="action">الإجراء</Label>
                <select id="action" name="action" defaultValue={fAction} className={selectCls}>
                  <option value="">الكل</option>
                  {Object.entries(ACTION).map(([k, v]) => <option key={k} value={k}>{v.ar}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="entity">نوع المستند</Label>
                <select id="entity" name="entity" defaultValue={fEntity} className={selectCls}>
                  <option value="">الكل</option>
                  {Object.entries(ENTITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div className="flex gap-2">
                <Button type="submit" className="flex-1">تطبيق</Button>
                {hasFilters && <Button type="button" variant="outline" asChild><a href="/erp/audit">مسح</a></Button>}
              </div>
            </form>
          </details>

          {rows.length === 0 ? (
            <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">لا توجد أحداث.</div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-start">التاريخ والوقت</TableHead>
                    <TableHead className="text-start">المستخدم</TableHead>
                    <TableHead className="text-start">الإجراء</TableHead>
                    <TableHead className="text-start">نوع المستند</TableHead>
                    <TableHead className="text-start">الرقم</TableHead>
                    <TableHead className="text-start">التفاصيل</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    const a = ACTION[r.action] ?? { ar: r.action, variant: "secondary" as const };
                    return (
                      <TableRow key={r.id}>
                        <TableCell className="whitespace-nowrap font-mono text-xs">{dt(r.createdAt)}</TableCell>
                        <TableCell>{r.userName ?? "—"}</TableCell>
                        <TableCell><Badge variant={a.variant}>{a.ar}</Badge></TableCell>
                        <TableCell>{ENTITY[r.entityType] ?? r.entityType}</TableCell>
                        <TableCell className="font-mono">{r.entityNumber ?? "—"}</TableCell>
                        <TableCell className="text-muted-foreground">{r.summary ?? "—"}</TableCell>
                      </TableRow>
                    );
                  })}
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
