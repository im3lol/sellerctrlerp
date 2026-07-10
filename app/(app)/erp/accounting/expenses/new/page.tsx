import { and, asc, eq, sql } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { accounts } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { ExpenseForm } from "@/components/erp/expense-form";

export default async function NewExpensePage() {
  const { orgId } = await requireErpModule("accounting.view");

  const [expenseAccs, cashAccs] = await Promise.all([
    db.select({ id: accounts.id, code: accounts.code, name: accounts.nameAr })
      .from(accounts)
      .where(and(eq(accounts.organizationId, orgId), eq(accounts.isLeaf, true), eq(accounts.isActive, true), eq(accounts.type, "EXPENSE")))
      .orderBy(asc(accounts.code)),
    db.select({ id: accounts.id, code: accounts.code, name: accounts.nameAr })
      .from(accounts)
      .where(and(
        eq(accounts.organizationId, orgId), eq(accounts.isLeaf, true), eq(accounts.isActive, true), eq(accounts.type, "ASSET"),
        sql`(${accounts.code} LIKE '1101%' OR ${accounts.code} LIKE '1102%')`,
      ))
      .orderBy(asc(accounts.code)),
  ]);

  return (
    <div className="space-y-6">
      <ErpPageHeader icon="Wallet" title="مصروف جديد" subtitle="صرف مصروف تشغيلي من النقدية/البنك" backHref="/erp/accounting/expenses" />
      <ExpenseForm expenseAccounts={expenseAccs} cashAccounts={cashAccs} />
    </div>
  );
}
