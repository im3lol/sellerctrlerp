import { and, asc, eq, sql } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { accounts, organizations } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { ExpenseClaimForm } from "@/components/erp/expense-claim-form";

export default async function NewExpenseClaimPage() {
  return loadErpPage("accounting.view", async ({ orgId }) => {
    const [expenseAccs, cashAccs, org] = await Promise.all([
      db.select({ id: accounts.id, code: accounts.code, name: accounts.nameAr }).from(accounts)
        .where(and(eq(accounts.organizationId, orgId), eq(accounts.isLeaf, true), eq(accounts.isActive, true), eq(accounts.type, "EXPENSE"))).orderBy(asc(accounts.code)),
      db.select({ id: accounts.id, code: accounts.code, name: accounts.nameAr }).from(accounts)
        .where(and(eq(accounts.organizationId, orgId), eq(accounts.isLeaf, true), eq(accounts.isActive, true), eq(accounts.type, "ASSET"),
          sql`(${accounts.code} LIKE '1101%' OR ${accounts.code} LIKE '1102%')`)).orderBy(asc(accounts.code)),
      db.select({ nameAr: organizations.nameAr }).from(organizations).where(eq(organizations.id, orgId)).limit(1),
    ]);
    return (
      <div className="space-y-6">
        <ErpPageHeader icon="ReceiptText" title="مطالبة مصروفات جديدة" subtitle="مصروفات موظف — تُرحّل عند الاعتماد" backHref="/hr/expense-claims" />
        <ExpenseClaimForm expenseAccounts={expenseAccs} cashAccounts={cashAccs} orgName={org[0]?.nameAr ?? "—"} />
      </div>
    );
  });
}
