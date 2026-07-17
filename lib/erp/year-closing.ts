import { round2 } from "@/lib/erp/money";

// Pure year-end closing math — single source of truth for both the preview and the
// posting of the closing journal entry. Every P&L account with a non-zero SIGNED
// balance is closed on the side that zeroes it, regardless of which side its
// balance sits on. A REVENUE account carrying a debit balance (e.g. 4102 مردودات
// المبيعات / sales returns) reduces revenue and is credited to zero — the old code
// dropped such wrong-side accounts (`if (amount > 0)`), overstating retained
// earnings and leaving the account un-closed.

// `type` is the account type as it comes from the DB (string); anything not
// "REVENUE" is treated as an expense — the caller filters to REVENUE/EXPENSE.
export type PLRow = { id: string; code: string; nameAr: string; type: string; debit: number | string; credit: number | string };
export type ClosingAcc = { code: string; nameAr: string; accountId: string; amount: number };
export type ClosingLine = { accountId: string; debit: number; credit: number; nameAr: string };

export function computeYearClosing(rows: PLRow[]) {
  const revenues: ClosingAcc[] = [];
  const expenses: ClosingAcc[] = [];
  const plLines: ClosingLine[] = [];
  let totalRevenue = 0;
  let totalExpense = 0;

  for (const r of rows) {
    const d = Number(r.debit), c = Number(r.credit);
    if (r.type === "REVENUE") {
      const amount = round2(c - d); // signed net revenue (negative for contra-revenue)
      if (amount === 0) continue;
      revenues.push({ code: r.code, nameAr: r.nameAr, accountId: r.id, amount });
      totalRevenue = round2(totalRevenue + amount);
      // zero it: net-credit → debit; net-debit (contra) → credit
      plLines.push({ accountId: r.id, debit: amount > 0 ? amount : 0, credit: amount < 0 ? -amount : 0, nameAr: r.nameAr });
    } else {
      const amount = round2(d - c); // signed net expense (negative for contra-expense)
      if (amount === 0) continue;
      expenses.push({ code: r.code, nameAr: r.nameAr, accountId: r.id, amount });
      totalExpense = round2(totalExpense + amount);
      // zero it: net-debit → credit; net-credit (contra) → debit
      plLines.push({ accountId: r.id, debit: amount < 0 ? -amount : 0, credit: amount > 0 ? amount : 0, nameAr: r.nameAr });
    }
  }

  const netIncome = round2(totalRevenue - totalExpense);
  return { revenues, expenses, totalRevenue, totalExpense, netIncome, plLines };
}
