import { and, desc, eq, sql } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { accounts, investors, withdrawals } from "@/db/schema";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ErpPageHeader } from "@/components/erp/page-header";
import { InvestorTxnForm } from "@/components/erp/investor-txn-form";

const money = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dt = (d: Date | string) => new Date(d).toISOString().slice(0, 10);

export default async function WithdrawalsPage() {
  return loadErpPage("investors.view", async ({ orgId, can }) => {
    const [rows, people, cash] = await Promise.all([
      db.select({
        id: withdrawals.id, date: withdrawals.date, amount: withdrawals.amount, type: withdrawals.type,
        notes: withdrawals.notes, investor: investors.fullName,
        account: sql<string>`(SELECT code || ' — ' || name_ar FROM accounts WHERE id = ${withdrawals.accountId})`,
      }).from(withdrawals)
        .innerJoin(investors, eq(investors.id, withdrawals.investorId))
        .where(eq(withdrawals.organizationId, orgId))
        .orderBy(desc(withdrawals.date)),
      db.select({ id: investors.id, code: investors.code, name: investors.fullName }).from(investors)
        .where(and(eq(investors.organizationId, orgId), eq(investors.status, "active"))),
      db.select({ id: accounts.id, code: accounts.code, name: accounts.nameAr }).from(accounts)
        .where(and(eq(accounts.organizationId, orgId), eq(accounts.isLeaf, true), eq(accounts.type, "ASSET"),
          sql`(${accounts.code} LIKE '1101%' OR ${accounts.code} LIKE '1102%')`)),
    ]);

    const capital = rows.filter((r) => r.type === "capital").reduce((s, r) => s + Number(r.amount), 0);
    const profit = rows.filter((r) => r.type === "profit").reduce((s, r) => s + Number(r.amount), 0);

    return (
      <div className="space-y-6" dir="rtl">
        <ErpPageHeader icon="Banknote" title="سحوبات المستثمرين"
          subtitle={`أرباح مصروفة ${money(profit)} · سحب رأس مال ${money(capital)}`} backHref="/erp/investors"
          action={can("accounting.post") ? (
            <InvestorTxnForm kind="withdrawal"
              investors={people.map((p) => ({ id: p.id, label: `${p.code} — ${p.name}` }))}
              cashAccounts={cash.map((c) => ({ id: c.id, label: `${c.code} — ${c.name}` }))} />
          ) : undefined}
        />

        <Card>
          <CardContent className="p-0">
            {rows.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">لا توجد سحوبات بعد.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-right">
                  <tr>
                    <th className="p-3 font-medium">التاريخ</th>
                    <th className="p-3 font-medium">المستثمر</th>
                    <th className="p-3 font-medium">النوع</th>
                    <th className="p-3 font-medium">صُرف من</th>
                    <th className="p-3 text-left font-medium">المبلغ</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-b last:border-0">
                      <td className="p-3 tabular-nums text-muted-foreground">{dt(r.date)}</td>
                      <td className="p-3">{r.investor}</td>
                      <td className="p-3">
                        <Badge variant={r.type === "capital" ? "destructive" : "secondary"}>
                          {r.type === "capital" ? "سحب رأس مال" : "صرف أرباح"}
                        </Badge>
                      </td>
                      <td className="p-3 text-muted-foreground">{r.account ?? "—"}</td>
                      <td className="p-3 text-left font-semibold tabular-nums">{money(Number(r.amount))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>
    );
  });
}
