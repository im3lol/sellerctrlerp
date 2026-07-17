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

export default async function QuotationsPage() {
  return loadErpPage("sales.view", async ({ orgId, can }) => {
    const canManage = can("sales.create");

    const rows = await db.select({
      id: salesQuotations.id, number: salesQuotations.number, date: salesQuotations.date, validUntil: salesQuotations.validUntil,
      status: salesQuotations.status, customer: customers.nameAr,
      total: sql<string>`(select coalesce(sum(quantity*unit_price - discount_amount + tax_amount),0) from ${salesQuotationLines} where ${salesQuotationLines.quotationId} = ${salesQuotations.id})`,
    })
      .from(salesQuotations)
      .leftJoin(customers, eq(customers.id, salesQuotations.customerId))
      .where(eq(salesQuotations.organizationId, orgId))
      .orderBy(desc(salesQuotations.date), desc(salesQuotations.number));

    return (
      <div className="space-y-6">
        <ErpPageHeader icon="FileText" title="عروض الأسعار" subtitle={`${rows.length} عرض`} backHref="/erp/sales"
          action={canManage ? <Button asChild><Link href="/erp/sales/quotations/new"><Icon name="Plus" className="size-4" />عرض جديد</Link></Button> : undefined} />
        <Card>
          <CardContent className="p-0">
            {rows.length === 0 ? (
              <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">لا توجد عروض أسعار بعد.</div>
            ) : (
              <div className="p-4"><QuotationsTable rows={rows} canDelete={canManage} /></div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  });
}
