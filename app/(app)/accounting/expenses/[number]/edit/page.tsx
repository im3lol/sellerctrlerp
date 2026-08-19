import { notFound, redirect } from "next/navigation";
import { and, asc, eq, sql } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { accounts, expenses } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { ExpenseForm, type ExpenseInitial } from "@/components/erp/expense-form";
import { docNumberParam } from "@/lib/erp/doc-route";

export default async function EditExpensePage({ params }: { params: Promise<{ number: string }> }) {
  const raw = (await params).number;
  return loadErpPage("accounting.create", async ({ orgId }) => {
    const number = await docNumberParam(raw, orgId, expenses,
      { id: expenses.id, number: expenses.number, organizationId: expenses.organizationId }, "/accounting/expenses", "/edit");
    const [exp] = await db.select().from(expenses)
      .where(and(eq(expenses.number, number), eq(expenses.organizationId, orgId))).limit(1);
    if (!exp) notFound();
    if (exp.status !== "DRAFT") redirect(`/accounting/expenses`);

    const [expenseAccs, cashAccs] = await Promise.all([
      db.select({ id: accounts.id, code: accounts.code, name: accounts.nameAr }).from(accounts)
        .where(and(eq(accounts.organizationId, orgId), eq(accounts.isLeaf, true), eq(accounts.isActive, true), eq(accounts.type, "EXPENSE"))).orderBy(asc(accounts.code)),
      db.select({ id: accounts.id, code: accounts.code, name: accounts.nameAr }).from(accounts)
        .where(and(eq(accounts.organizationId, orgId), eq(accounts.isLeaf, true), eq(accounts.isActive, true), eq(accounts.type, "ASSET"), sql`(${accounts.code} LIKE '1101%' OR ${accounts.code} LIKE '1102%')`)).orderBy(asc(accounts.code)),
    ]);

    const initial: ExpenseInitial = {
      id: exp.id, expenseAccountId: exp.expenseAccountId, cashAccountId: exp.cashAccountId,
      amount: String(Number(exp.amount) || ""), date: new Date(exp.date).toISOString().slice(0, 10),
      method: exp.paymentMethod ?? "CASH", payee: exp.payee ?? "", reference: exp.reference ?? "", notes: exp.notes ?? "",
    };

    return (
      <div className="space-y-6">
        <ErpPageHeader icon="Wallet" title={`تعديل مصروف ${exp.number}`} subtitle="مسودة — عدّل بيانات المصروف ثم احفظ" backHref="/accounting/expenses" />
        <ExpenseForm expenseAccounts={expenseAccs} cashAccounts={cashAccs} initial={initial} />
      </div>
    );
  });
}
