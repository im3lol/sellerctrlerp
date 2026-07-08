import { requireErpModule } from "@/lib/erp/org";
import { accountBalances, naturalAmount } from "@/lib/erp/financials";
import { xlsxResponse } from "@/lib/erp/xlsx";

export const runtime = "nodejs";

/** Excel export of the balance sheet as of the page's date. */
export async function GET(req: Request) {
  const { orgId } = await requireErpModule("reports.view");
  const to = new URL(req.url).searchParams.get("to") || new Date().toISOString().slice(0, 10);
  const balances = await accountBalances({ orgId, to: new Date(`${to}T23:59:59`) });

  const pick = (type: string) => balances.filter((b) => b.type === type).map((b) => ({ ...b, amount: naturalAmount(b) })).filter((b) => b.amount !== 0);
  const assets = pick("ASSET");
  const liabilities = pick("LIABILITY");
  const equity = pick("EQUITY");
  const totalAssets = assets.reduce((s, b) => s + b.amount, 0);
  const totalLiabilities = liabilities.reduce((s, b) => s + b.amount, 0);
  const netIncome = balances.filter((b) => b.type === "REVENUE").reduce((s, b) => s + naturalAmount(b), 0) - balances.filter((b) => b.type === "EXPENSE").reduce((s, b) => s + naturalAmount(b), 0);
  const totalEquity = equity.reduce((s, b) => s + b.amount, 0) + netIncome;

  const rows: (string | number)[][] = [];
  assets.forEach((b) => rows.push(["أصول", b.code, b.nameAr, b.amount]));
  rows.push(["", "", "إجمالي الأصول", totalAssets]);
  liabilities.forEach((b) => rows.push(["خصوم", b.code, b.nameAr, b.amount]));
  rows.push(["", "", "إجمالي الخصوم", totalLiabilities]);
  equity.forEach((b) => rows.push(["حقوق ملكية", b.code, b.nameAr, b.amount]));
  rows.push(["حقوق ملكية", "", "صافي ربح الفترة", netIncome]);
  rows.push(["", "", "إجمالي حقوق الملكية", totalEquity]);

  return xlsxResponse({
    sheet: "الميزانية العمومية",
    filename: `balance-sheet-${to}`,
    headers: ["البند", "الكود", "الحساب", "المبلغ"],
    rows,
    totalRow: ["", "", "إجمالي الخصوم وحقوق الملكية", totalLiabilities + totalEquity],
    colWidths: [14, 12, 34, 16],
  });
}
