import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { expenseClaims, expenseClaimLines } from "@/db/schema";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";
import { ErpPageHeader } from "@/components/erp/page-header";
import { ExpenseClaimsTable } from "@/components/erp/expense-claims-table";

export default async function ExpenseClaimsPage() {
  return loadErpPage("accounting.view", async ({ orgId, can }) => {
    const rows = await db.select({
      id: expenseClaims.id, number: expenseClaims.number, date: expenseClaims.date, employee: expenseClaims.employeeName, status: expenseClaims.status,
      total: sql<string>`(select coalesce(sum(amount),0) from ${expenseClaimLines} where ${expenseClaimLines.claimId} = ${expenseClaims.id})`,
    }).from(expenseClaims).where(eq(expenseClaims.organizationId, orgId)).orderBy(desc(expenseClaims.date), desc(expenseClaims.number));

    return (
      <div className="space-y-6">
        <ErpPageHeader icon="ReceiptText" title="مطالبات مصروفات الموظفين" subtitle={`${rows.length} مطالبة`} backHref="/hr"
          action={can("accounting.create") ? <Button asChild><Link href="/hr/expense-claims/new"><Icon name="Plus" className="size-4" />مطالبة جديدة</Link></Button> : undefined} />
        <Card>
          <CardContent className="p-0">
            {rows.length === 0 ? (
              <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">لا توجد مطالبات بعد.</div>
            ) : (
              <ExpenseClaimsTable rows={rows} canApprove={can("accounting.post")} canCreate={can("accounting.create")} />
            )}
          </CardContent>
        </Card>
      </div>
    );
  });
}
