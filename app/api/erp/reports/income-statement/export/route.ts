import { requireErpModule } from "@/lib/erp/org";
import { withOrgScope } from "@/lib/db-scope";
import { accountBalances, naturalAmount } from "@/lib/erp/financials";
import { orgFiscalYearStartISO } from "@/lib/erp/fiscal";
import { xlsxResponse } from "@/lib/erp/xlsx";

export const runtime = "nodejs";

/** Excel export of the income statement for the page's period. */
export async function GET(req: Request) {
  const { orgId } = await requireErpModule("reports.view");
  const p = new URL(req.url).searchParams;
  const now = new Date();

  const { from, to, balances } = await withOrgScope(orgId, false, async () => {
    const from = p.get("from") || (await orgFiscalYearStartISO(orgId, now));
    const to = p.get("to") || now.toISOString().slice(0, 10);
    const balances = await accountBalances({ orgId, from: new Date(from), to: new Date(`${to}T23:59:59`), excludeClosing: true });
    return { from, to, balances };
  });
  const revenue = balances.filter((b) => b.type === "REVENUE").map((b) => ({ ...b, amount: naturalAmount(b) })).filter((b) => b.amount !== 0);
  const expense = balances.filter((b) => b.type === "EXPENSE").map((b) => ({ ...b, amount: naturalAmount(b) })).filter((b) => b.amount !== 0);
  const totalRevenue = revenue.reduce((s, b) => s + b.amount, 0);
  const totalExpense = expense.reduce((s, b) => s + b.amount, 0);
  const net = totalRevenue - totalExpense;

  const rows: (string | number)[][] = [];
  revenue.forEach((b) => rows.push(["إيراد", b.code, b.nameAr, b.amount]));
  rows.push(["", "", "إجمالي الإيرادات", totalRevenue]);
  expense.forEach((b) => rows.push(["مصروف", b.code, b.nameAr, b.amount]));
  rows.push(["", "", "إجمالي المصروفات", totalExpense]);

  return xlsxResponse({
    sheet: "قائمة الدخل",
    filename: `income-statement-${from}_${to}`,
    headers: ["النوع", "الكود", "الحساب", "المبلغ"],
    rows,
    totalRow: ["", "", "صافي الربح / (الخسارة)", net],
    colWidths: [12, 12, 34, 16],
  });
}
