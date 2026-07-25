import { notFound } from "next/navigation";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { salesPlatforms, fbaReimbursements } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Pagination } from "@/components/erp/pagination";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { selectCls } from "@/lib/utils";

const PER_PAGE = 50;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const money = (n: string) => Number(n).toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = (n: string) => Number(n).toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 3 });
const dt = (d: Date | null) => (d ? new Date(d).toLocaleDateString("ar-EG-u-nu-latn") : "—");

// Common reimbursement reasons → Arabic.
const REASON_AR: Record<string, string> = {
  Lost_warehouse: "مفقود بالمستودع",
  Lost_inbound: "مفقود أثناء الاستلام",
  Damaged_warehouse: "تالف بالمستودع",
  Damaged_inbound: "تالف أثناء الاستلام",
  CustomerReturn: "مرتجع عميل",
  CustomerServiceIssue: "خدمة عملاء",
  Fee_correction: "تصحيح رسوم",
};

type SP = { page?: string; q?: string };

/** تعويضات أمازون FBA — سجل قراءة فقط لما دفعته أمازون عن الفقد/التلف. */
export default async function PlatformReimbursementsPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<SP> }) {
  const code = decodeURIComponent((await params).code).toUpperCase();
  const sp = await searchParams;
  const fQ = one(sp.q).trim();
  const page = Math.max(1, Number(one(sp.page)) || 1);

  return loadErpPage("sales.view", async ({ orgId }) => {
    const [platform] = await db.select({ id: salesPlatforms.id, name: salesPlatforms.name, code: salesPlatforms.code })
      .from(salesPlatforms)
      .where(and(eq(salesPlatforms.organizationId, orgId), sql`upper(${salesPlatforms.code}) = ${code}`)).limit(1);
    if (!platform) notFound();

    const conds = [eq(fbaReimbursements.organizationId, orgId)];
    if (fQ) {
      const like = `%${fQ}%`;
      conds.push(or(ilike(fbaReimbursements.sku, like), ilike(fbaReimbursements.orderId, like), ilike(fbaReimbursements.reimbursementId, like), ilike(fbaReimbursements.reason, like))!);
    }
    const where = and(...conds);
    const [[{ n }], rows, [totals]] = await Promise.all([
      db.select({ n: sql<number>`count(*)` }).from(fbaReimbursements).where(where),
      db.select().from(fbaReimbursements).where(where)
        .orderBy(desc(fbaReimbursements.approvalDate)).limit(PER_PAGE).offset((page - 1) * PER_PAGE),
      db.select({ amount: sql<string>`coalesce(sum(${fbaReimbursements.amountTotal}), 0)`, qtyInv: sql<string>`coalesce(sum(${fbaReimbursements.quantityReimbursedInventory}), 0)` })
        .from(fbaReimbursements).where(where),
    ]);
    const total = Number(n ?? 0);
    const pages = Math.max(1, Math.ceil(total / PER_PAGE));

    return (
      <div className="space-y-6">
        <ErpPageHeader
          icon="HandCoins"
          title={`تعويضات ${platform.name}`}
          subtitle={`${total.toLocaleString("ar-EG-u-nu-latn")} تعويض · إجمالي نقدي ${money(totals?.amount ?? "0")} · معوَّض كمخزون ${qty(totals?.qtyInv ?? "0")}`}
          backHref={`/platforms/${platform.code.toLowerCase()}`}
        />

        <Card>
          <CardContent className="pt-6">
            <form className="grid items-end gap-3 sm:grid-cols-[1fr_auto]">
              <div className="space-y-1.5">
                <Label htmlFor="q">بحث (SKU / رقم الطلب / رقم التعويض / السبب)</Label>
                <input id="q" name="q" defaultValue={fQ} placeholder="اكتب للبحث…" className={selectCls} />
              </div>
              <Button type="submit">بحث</Button>
            </form>
          </CardContent>
        </Card>

        {rows.length === 0 ? (
          <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">
            لا توجد تعويضات بعد — تُسحب تلقائيًا يوميًا من أمازون بعد الربط.
          </CardContent></Card>
        ) : (
          <>
            <div className="max-h-[70vh] overflow-auto rounded-xl border">
              <Table>
                <TableHeader className="sticky top-0 bg-background">
                  <TableRow>
                    <TableHead className="text-start">التاريخ</TableHead>
                    <TableHead className="text-start">رقم التعويض</TableHead>
                    <TableHead className="text-start">الصنف</TableHead>
                    <TableHead className="text-start">السبب</TableHead>
                    <TableHead className="text-start">نقدًا</TableHead>
                    <TableHead className="text-start">كمخزون</TableHead>
                    <TableHead className="text-start">المبلغ</TableHead>
                    <TableHead className="text-start">رقم الطلب</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="whitespace-nowrap">{dt(r.approvalDate)}</TableCell>
                      <TableCell className="font-mono text-xs" dir="ltr">{r.reimbursementId}</TableCell>
                      <TableCell className="font-mono text-xs" dir="ltr">{r.sku ?? "—"}</TableCell>
                      <TableCell>{(r.reason && REASON_AR[r.reason]) ?? r.reason ?? "—"}</TableCell>
                      <TableCell className="tabular-nums">{qty(r.quantityReimbursedCash)}</TableCell>
                      <TableCell className="tabular-nums">{qty(r.quantityReimbursedInventory)}</TableCell>
                      <TableCell className="tabular-nums font-medium">{money(r.amountTotal)} {r.currency ?? ""}</TableCell>
                      <TableCell className="font-mono text-xs" dir="ltr">{r.orderId || "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <Pagination page={page} pages={pages} total={total} unit="تعويض" basePath={`/platforms/${platform.code.toLowerCase()}/reimbursements`} params={{ q: fQ }} />
          </>
        )}
      </div>
    );
  }, "marketplace");
}
