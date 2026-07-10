import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { salesQuotations, salesQuotationLines, customers } from "@/db/schema";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Icon } from "@/components/icon";
import { ErpPageHeader } from "@/components/erp/page-header";
import { QuotationRowActions } from "@/components/erp/quotation-row-actions";

const dt = (d: unknown) => new Date(d as string).toLocaleDateString("en-GB", { year: "numeric", month: "2-digit", day: "2-digit" });
const fmt = (v: unknown) => Number(v ?? 0).toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ST: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  DRAFT: { label: "مسودة", variant: "secondary" }, SENT: { label: "مُرسل", variant: "outline" },
  ACCEPTED: { label: "مقبول", variant: "default" }, REJECTED: { label: "مرفوض", variant: "destructive" },
};

export default async function QuotationsPage() {
  const { orgId, can } = await requireErpModule("sales.view");
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
            <Table>
              <TableHeader><TableRow>
                <TableHead className="text-start">الرقم</TableHead>
                <TableHead className="text-start">التاريخ</TableHead>
                <TableHead className="text-start">العميل</TableHead>
                <TableHead className="text-start">صالح حتى</TableHead>
                <TableHead className="text-end">الإجمالي</TableHead>
                <TableHead className="text-start">الحالة</TableHead>
                {canManage && <TableHead className="text-start">إجراءات</TableHead>}
              </TableRow></TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const st = ST[r.status] ?? ST.DRAFT;
                  return (
                    <TableRow key={r.id}>
                      <TableCell><Link href={`/erp/sales/quotations/${r.id}`} className="font-mono hover:text-primary">{r.number}</Link></TableCell>
                      <TableCell>{dt(r.date)}</TableCell>
                      <TableCell>{r.customer ?? "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{r.validUntil ? dt(r.validUntil) : "—"}</TableCell>
                      <TableCell className="text-end tabular-nums font-medium">{fmt(r.total)}</TableCell>
                      <TableCell><Badge variant={st.variant}>{st.label}</Badge></TableCell>
                      {canManage && <TableCell><QuotationRowActions id={r.id} status={r.status} canManage={canManage} /></TableCell>}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
