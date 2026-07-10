import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { expenseClaims, expenseClaimLines } from "@/db/schema";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Icon } from "@/components/icon";
import { ErpPageHeader } from "@/components/erp/page-header";
import { ExpenseClaimRowActions } from "@/components/erp/expense-claim-row-actions";

const dt = (d: unknown) => new Date(d as string).toLocaleDateString("en-GB", { year: "numeric", month: "2-digit", day: "2-digit" });
const fmt = (v: unknown) => Number(v ?? 0).toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default async function ExpenseClaimsPage() {
  const { orgId, can } = await requireErpModule("accounting.view");
  const canManage = can("accounting.post");

  const rows = await db.select({
    id: expenseClaims.id, number: expenseClaims.number, date: expenseClaims.date, employee: expenseClaims.employeeName, status: expenseClaims.status,
    total: sql<string>`(select coalesce(sum(amount),0) from ${expenseClaimLines} where ${expenseClaimLines.claimId} = ${expenseClaims.id})`,
  }).from(expenseClaims).where(eq(expenseClaims.organizationId, orgId)).orderBy(desc(expenseClaims.date), desc(expenseClaims.number));

  return (
    <div className="space-y-6">
      <ErpPageHeader icon="ReceiptText" title="مطالبات مصروفات الموظفين" subtitle={`${rows.length} مطالبة`} backHref="/erp/hr/employees"
        action={can("accounting.create") ? <Button asChild><Link href="/erp/hr/expense-claims/new"><Icon name="Plus" className="size-4" />مطالبة جديدة</Link></Button> : undefined} />
      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">لا توجد مطالبات بعد.</div>
          ) : (
            <Table>
              <TableHeader><TableRow>
                <TableHead className="text-start">الرقم</TableHead><TableHead className="text-start">التاريخ</TableHead>
                <TableHead className="text-start">الموظف</TableHead><TableHead className="text-end">الإجمالي</TableHead>
                <TableHead className="text-start">الحالة</TableHead>{canManage && <TableHead className="text-start">إجراءات</TableHead>}
              </TableRow></TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell><Link href={`/erp/hr/expense-claims/${r.id}`} className="font-mono hover:text-primary">{r.number}</Link></TableCell>
                    <TableCell>{dt(r.date)}</TableCell>
                    <TableCell>{r.employee}</TableCell>
                    <TableCell className="text-end tabular-nums font-medium">{fmt(r.total)}</TableCell>
                    <TableCell><Badge variant={r.status === "APPROVED" ? "default" : "secondary"}>{r.status === "APPROVED" ? "معتمد" : "مسودة"}</Badge></TableCell>
                    {canManage && <TableCell><ExpenseClaimRowActions id={r.id} status={r.status} canManage={canManage} /></TableCell>}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
