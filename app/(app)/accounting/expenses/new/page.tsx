import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { accounts, projects } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { ExpenseForm } from "@/components/erp/expense-form";

export default async function NewExpensePage() {
  return loadErpPage("accounting.view", async ({ orgId }) => {
    const [expenseAccs, cashAccs, projectRows] = await Promise.all([
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
      db.select({ id: projects.id, code: projects.code, nameAr: projects.nameAr })
        .from(projects)
        .where(and(eq(projects.organizationId, orgId), inArray(projects.status, ["DRAFT", "ACTIVE", "ON_HOLD"])))
        .orderBy(asc(projects.code)),
    ]);

    return (
      <div className="space-y-6">
        <ErpPageHeader icon="Wallet" title="مصروف جديد" subtitle="صرف مصروف تشغيلي من النقدية/البنك" backHref="/accounting/expenses" />
        <ExpenseForm expenseAccounts={expenseAccs} cashAccounts={cashAccs}
          projects={projectRows.map((p) => ({ id: p.id, label: `${p.code} — ${p.nameAr}` }))} />
      </div>
    );
  });
}
