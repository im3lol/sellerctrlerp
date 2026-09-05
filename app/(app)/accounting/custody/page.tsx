import { and, asc, eq, inArray } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { employees, accounts, users } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { CustodyManager } from "@/components/erp/custody-manager";

export default async function CustodyPage() {
  return loadErpPage("accounting.view", async ({ orgId, can }) => {
    const [staff, cash, expense] = await Promise.all([
      db.select({ id: employees.id, fullName: employees.fullName, code: employees.employeeCode, name: users.name })
        .from(employees)
        .leftJoin(users, eq(users.id, employees.userId))
        .where(and(eq(employees.organizationId, orgId), eq(employees.isActive, true)))
        .orderBy(asc(employees.employeeCode)),

      // Cash and bank leaves — where an advance can physically come from.
      db.select({ id: accounts.id, code: accounts.code, nameAr: accounts.nameAr })
        .from(accounts)
        .where(and(eq(accounts.organizationId, orgId), eq(accounts.isLeaf, true), inArray(accounts.code, ["1101", "1102"])))
        .orderBy(asc(accounts.code)),

      db.select({ id: accounts.id, code: accounts.code, nameAr: accounts.nameAr })
        .from(accounts)
        .where(and(eq(accounts.organizationId, orgId), eq(accounts.isLeaf, true), eq(accounts.type, "EXPENSE")))
        .orderBy(asc(accounts.code)),
    ]);

    return (
      <div className="space-y-6">
        <ErpPageHeader
          icon="HandCoins"
          title="العُهد"
          subtitle="فلوس مع الموظف لحساب الشركة — والرصيد هو اللي لسه في إيده"
          backHref="/accounting"
        />
        <CustodyManager
          canManage={can("accounting.post")}
          employees={staff.map((s) => ({ id: s.id, label: `${s.fullName ?? s.name ?? "—"}${s.code ? ` — ${s.code}` : ""}` }))}
          cashAccounts={cash.map((a) => ({ id: a.id, label: `${a.code} — ${a.nameAr}` }))}
          expenseAccounts={expense.map((a) => ({ id: a.id, label: `${a.code} — ${a.nameAr}` }))}
        />
      </div>
    );
  });
}
