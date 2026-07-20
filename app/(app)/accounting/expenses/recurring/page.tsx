import { aliasedTable, and, asc, desc, eq, sql } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { recurringExpenses, accounts } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { RecurringExpensesManager } from "@/components/erp/recurring-expenses-manager";

const ymd = (d: Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : "");

export default async function RecurringExpensesPage() {
  return loadErpPage("accounting.view", async ({ orgId }) => {
    const cat = aliasedTable(accounts, "cat");
    const cash = aliasedTable(accounts, "cash");

    const [rows, expenseAccs, cashAccs] = await Promise.all([
      db.select({
        id: recurringExpenses.id, expenseAccountId: recurringExpenses.expenseAccountId, cashAccountId: recurringExpenses.cashAccountId,
        amount: recurringExpenses.amount, frequency: recurringExpenses.frequency, nextRunDate: recurringExpenses.nextRunDate,
        paymentMethod: recurringExpenses.paymentMethod, payee: recurringExpenses.payee, notes: recurringExpenses.notes, isActive: recurringExpenses.isActive,
        category: cat.nameAr, paidFrom: cash.nameAr,
      })
        .from(recurringExpenses)
        .leftJoin(cat, eq(cat.id, recurringExpenses.expenseAccountId))
        .leftJoin(cash, eq(cash.id, recurringExpenses.cashAccountId))
        .where(eq(recurringExpenses.organizationId, orgId))
        .orderBy(desc(recurringExpenses.isActive), asc(recurringExpenses.nextRunDate)),
      db.select({ id: accounts.id, code: accounts.code, name: accounts.nameAr })
        .from(accounts).where(and(eq(accounts.organizationId, orgId), eq(accounts.isLeaf, true), eq(accounts.isActive, true), eq(accounts.type, "EXPENSE")))
        .orderBy(asc(accounts.code)),
      db.select({ id: accounts.id, code: accounts.code, name: accounts.nameAr })
        .from(accounts).where(and(eq(accounts.organizationId, orgId), eq(accounts.isLeaf, true), eq(accounts.isActive, true), eq(accounts.type, "ASSET"),
          sql`(${accounts.code} LIKE '1101%' OR ${accounts.code} LIKE '1102%')`))
        .orderBy(asc(accounts.code)),
    ]);

    const items = rows.map((r) => ({
      id: r.id, expenseAccountId: r.expenseAccountId, cashAccountId: r.cashAccountId, amount: Number(r.amount),
      frequency: r.frequency, nextRunDate: ymd(r.nextRunDate), paymentMethod: r.paymentMethod,
      payee: r.payee ?? "", notes: r.notes ?? "", isActive: r.isActive, category: r.category ?? "—", paidFrom: r.paidFrom ?? "—",
    }));

    return (
      <div className="space-y-6">
        <ErpPageHeader icon="Repeat" title="المصروفات المتكررة" subtitle="قوالب تُولّد مصروفاً كمسودة تلقائياً في موعدها" backHref="/accounting/expenses" />
        <RecurringExpensesManager items={items} expenseAccounts={expenseAccs} cashAccounts={cashAccs} />
      </div>
    );
  });
}
