import Link from "next/link";
import { and, asc, count, desc, eq, gte, ilike, inArray, lte, sql } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { purchaseInvoices, suppliers, purchaseReturns } from "@/db/schema";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Icon } from "@/components/icon";
import { ErpPageHeader } from "@/components/erp/page-header";
import { PurchaseInvoicesTable } from "@/components/erp/purchase-invoices-table";
import { selectCls } from "@/lib/utils";

const PER_PAGE = 10;
const money = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const STATUS_OPTIONS: [string, string][] = [
  ["DRAFT", "مسودة"], ["POSTED", "مرحّلة"], ["PARTIAL_PAID", "مدفوعة جزئياً"], ["PAID", "مدفوعة"], ["CANCELLED", "ملغاة"],
];

type SP = { [k: string]: string | string[] | undefined };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function PurchaseInvoicesPage({ searchParams }: { searchParams: Promise<SP> }) {
  return loadErpPage("purchases.view", async ({ orgId, role, can }) => {
    const canManage = can("purchases.create");
    const canPost = can("accounting.post");
    const sp = await searchParams;
    const q = one(sp.q).trim();
    const fStatus = one(sp.status);
    const fSupplier = one(sp.supplier);
    const from = one(sp.from);
    const to = one(sp.to);
    const page = Math.max(1, parseInt(one(sp.page) || "1", 10) || 1);

    const conds = [eq(purchaseInvoices.organizationId, orgId)];
    if (q) conds.push(ilike(purchaseInvoices.number, `%${q}%`));
    if (fStatus) conds.push(eq(purchaseInvoices.status, fStatus));
    if (fSupplier) conds.push(eq(purchaseInvoices.supplierId, fSupplier));
    if (from) conds.push(gte(purchaseInvoices.date, new Date(from)));
    if (to) conds.push(lte(purchaseInvoices.date, new Date(to + "T23:59:59")));
    const where = and(...conds);

    const [supList, [{ total }], [sum]] = await Promise.all([
      db.select({ id: suppliers.id, nameAr: suppliers.nameAr }).from(suppliers).where(eq(suppliers.organizationId, orgId)).orderBy(asc(suppliers.code)),
      db.select({ total: count() }).from(purchaseInvoices).where(where),
      // Filter-aware money totals (whole result set, not just the page).
      db.select({
        value: sql<string>`coalesce(sum(${purchaseInvoices.totalAmount}), 0)`,
        due: sql<string>`coalesce(sum(${purchaseInvoices.balanceDue}), 0)`,
      }).from(purchaseInvoices).where(where),
    ]);
    const totalValue = Number(sum?.value ?? 0);
    const totalDue = Number(sum?.due ?? 0);
    const pages = Math.max(1, Math.ceil(Number(total) / PER_PAGE));
    const safePage = Math.min(page, pages);

    const tableRows = await db
      .select({
        id: purchaseInvoices.id, number: purchaseInvoices.number, date: purchaseInvoices.date, status: purchaseInvoices.status,
        total: purchaseInvoices.totalAmount, balanceDue: purchaseInvoices.balanceDue, supplier: suppliers.nameAr,
      })
      .from(purchaseInvoices)
      .leftJoin(suppliers, eq(purchaseInvoices.supplierId, suppliers.id))
      .where(where)
      .orderBy(desc(purchaseInvoices.date), desc(purchaseInvoices.number))
      .limit(PER_PAGE)
      .offset((safePage - 1) * PER_PAGE);

    // Attach each invoice's returns (debit notes) as linked rows shown under it.
    const invIds = tableRows.map((r) => r.id);
    const retRows = invIds.length
      ? await db.select({ id: purchaseReturns.id, number: purchaseReturns.number, date: purchaseReturns.date, total: purchaseReturns.totalAmount, status: purchaseReturns.status, invId: purchaseReturns.purchaseInvoiceId })
          .from(purchaseReturns)
          .where(and(eq(purchaseReturns.organizationId, orgId), inArray(purchaseReturns.purchaseInvoiceId, invIds)))
          .orderBy(desc(purchaseReturns.date), desc(purchaseReturns.number))
      : [];
    const retsByInv = new Map<string, { id: string; number: string; date: Date; total: string | null; status: string }[]>();
    for (const r of retRows) {
      if (!r.invId) continue;
      const list = retsByInv.get(r.invId) ?? [];
      list.push({ id: r.id, number: r.number, date: r.date, total: r.total, status: r.status });
      retsByInv.set(r.invId, list);
    }
    const rows = tableRows.map((r) => ({
      ...r,
      returned: (retsByInv.get(r.id) ?? []).some((x) => x.status === "POSTED"),
      returns: retsByInv.get(r.id) ?? [],
    }));

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

    return (
      <div className="space-y-6">
        <ErpPageHeader
          icon="ReceiptText"
          title="فواتير الشراء"
          subtitle={`${total} فاتورة`}
          action={canManage ? (
            <Button asChild><Link href="/purchases/invoices/new"><Icon name="Plus" className="size-4" />فاتورة شراء</Link></Button>
          ) : undefined}
        />

        <div className="grid gap-4 sm:grid-cols-3">
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">إجمالي القيمة</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold tabular-nums">{money(totalValue)}</p></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">المدفوع</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold tabular-nums text-emerald-600">{money(totalValue - totalDue)}</p></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">المتبقّي (مستحق)</CardTitle></CardHeader><CardContent><p className={`text-2xl font-bold tabular-nums ${totalDue > 0 ? "text-amber-600" : ""}`}>{money(totalDue)}</p></CardContent></Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>الفواتير</CardTitle>
            <CardDescription>فواتير الشراء تُحفظ مسودة ثم تُؤكَّد (تُرحّل محاسبياً). حدّد عدّة مسودات لتأكيدها أو حذفها دفعةً واحدة.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <details open={hasFilters} className="rounded-lg border">
              <summary className="flex cursor-pointer select-none items-center gap-2 px-4 py-2 text-sm font-medium">
                <Icon name="ListFilter" className="size-4" /> بحث وتصفية
              </summary>
              <form className="grid gap-3 p-4 pt-0 sm:grid-cols-5 items-end">
                <div className="space-y-1"><Label htmlFor="q">رقم الفاتورة</Label><Input id="q" name="q" defaultValue={q} placeholder="PI-2026-..." /></div>
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
                  {hasFilters && <Button type="button" variant="outline" asChild><Link href="/purchases/invoices">مسح</Link></Button>}
                </div>
              </form>
            </details>

            {tableRows.length === 0 ? (
              <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">{hasFilters ? "لا توجد نتائج مطابقة." : "لا توجد فواتير بعد."}</div>
            ) : (
              <>
                <PurchaseInvoicesTable rows={rows} canCreate={canManage} canPost={canPost} />
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
