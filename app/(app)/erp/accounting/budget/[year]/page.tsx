import { and, eq, inArray } from "drizzle-orm";
import { requireErpModule, erpCan } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { accountBudgets, accounts } from "@/db/schema";
import { BudgetEntryClient } from "@/components/erp/budget-entry-client";
import { ErpPageHeader } from "@/components/erp/page-header";

type Params = { params: Promise<{ year: string }> };

export default async function BudgetEntryPage({ params }: Params) {
  const year = parseInt((await params).year, 10);
  const { orgId, role } = await requireErpModule("accounting.view");
  const canEdit = erpCan(role, "accounting.create");

  // Load all leaf P&L accounts
  const accs = await db
    .select({ id: accounts.id, code: accounts.code, nameAr: accounts.nameAr, type: accounts.type })
    .from(accounts)
    .where(
      and(
        eq(accounts.organizationId, orgId),
        eq(accounts.isLeaf, true),
        eq(accounts.isActive, true),
        inArray(accounts.type, ["REVENUE", "EXPENSE"]),
      ),
    )
    .orderBy(accounts.code);

  // Load existing budget for this year
  const existing = await db
    .select({ accountId: accountBudgets.accountId, amount: accountBudgets.amount })
    .from(accountBudgets)
    .where(and(eq(accountBudgets.organizationId, orgId), eq(accountBudgets.year, year)));

  const budgetMap = Object.fromEntries(existing.map((e) => [e.accountId, Number(e.amount)]));

  const rows = accs.map((a) => ({
    id: a.id,
    code: a.code,
    nameAr: a.nameAr,
    type: a.type,
    budget: budgetMap[a.id] ?? 0,
  }));

  return (
    <div className="space-y-6">
      <ErpPageHeader
        icon="Target"
        title={`ميزانية ${year}`}
        subtitle="ادخل الميزانية التقديرية لكل حساب إيرادات ومصروفات"
        backHref="/erp/accounting/budget"
      />
      <BudgetEntryClient year={year} rows={rows} canEdit={canEdit} />
    </div>
  );
}
