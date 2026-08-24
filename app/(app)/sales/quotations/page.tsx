import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { salesQuotations, salesQuotationLines, customers } from "@/db/schema";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";
import { ErpPageHeader } from "@/components/erp/page-header";
import { QuotationsTable } from "@/components/erp/quotations-table";

const money = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default async function QuotationsPage() {
  return loadErpPage("sales.view", async ({ orgId, can }) => {
    const canManage = can("sales.create");

    const rows = await db.select({
      id: salesQuotations.id, number: salesQuotations.number, date: salesQuotations.date, validUntil: salesQuotations.validUntil,
      status: salesQuotations.status, customer: customers.nameAr,
      // The lines' net, minus the whole-quote discount stored on the header. Floored at 0.
      total: sql<string>`greatest((select coalesce(sum(quantity*unit_price - discount_amount + tax_amount),0) from ${salesQuotationLines} where ${salesQuotationLines.quotationId} = ${salesQuotations.id}) - ${salesQuotations.discountAmount}, 0)`,
    })
      .from(salesQuotations)
      .leftJoin(customers, eq(customers.id, salesQuotations.customerId))
      .where(eq(salesQuotations.organizationId, orgId))
      .orderBy(desc(salesQuotations.date), desc(salesQuotations.number));

    // Rows are already loaded (no pagination) → summarize in JS, no extra query.
    const todayIso = new Date().toISOString().slice(0, 10);
    const totalValue = rows.reduce((s, r) => s + Number(r.total ?? 0), 0);
    const validValue = rows.reduce((s, r) => s + (r.validUntil && new Date(r.validUntil).toISOString().slice(0, 10) >= todayIso ? Number(r.total ?? 0) : 0), 0);

    return (
      <div className="space-y-6">
        <ErpPageHeader icon="FileText" title="عروض الأسعار" subtitle={`${rows.length} عرض`} backHref="/sales"
          action={canManage ? <Button asChild><Link href="/sales/quotations/new"><Icon name="Plus" className="size-4" />عرض جديد</Link></Button> : undefined} />

        {rows.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Card><CardContent className="pt-6"><div className="text-sm text-muted-foreground">إجمالي قيمة العروض</div><p className="mt-1 text-2xl font-bold tabular-nums">{money(totalValue)}</p></CardContent></Card>
            <Card><CardContent className="pt-6"><div className="text-sm text-muted-foreground">قيمة العروض السارية</div><p className="mt-1 text-2xl font-bold tabular-nums text-emerald-600">{money(validValue)}</p></CardContent></Card>
          </div>
        )}

        <Card>
          <CardContent className="p-0">
            {rows.length === 0 ? (
              <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">لا توجد عروض أسعار بعد.</div>
            ) : (
              <div className="p-4"><QuotationsTable rows={rows} canConfirm={can("sales.confirm")} canCreate={can("sales.create")} /></div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  });
}
