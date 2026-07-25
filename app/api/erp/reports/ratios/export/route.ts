import { requireErpModule } from "@/lib/erp/org";
import { withOrgScope } from "@/lib/db-scope";
import { accountBalances, naturalAmount } from "@/lib/erp/financials";
import { resolveAccountCodes } from "@/lib/erp/accounting-config";
import { xlsxResponse } from "@/lib/erp/xlsx";

export const runtime = "nodejs";
const r2 = (n: number) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : "—");
const pct = (n: number) => (Number.isFinite(n) ? Math.round(n * 1000) / 10 : "—");

/** Excel export of the financial ratios from current ledger balances (real DB data). */
export async function GET() {
  const { orgId } = await requireErpModule("reports.view");
  return withOrgScope(orgId, false, async () => {
  const balances = await accountBalances({ orgId });

  const byCode = Object.fromEntries(balances.map((b) => [b.code, Number(b.balance)]));
  const sumWhere = (pred: (b: (typeof balances)[number]) => boolean) => balances.filter(pred).reduce((s, b) => s + naturalAmount(b), 0);

  const revenue = sumWhere((b) => b.type === "REVENUE");
  const expenseTotal = sumWhere((b) => b.type === "EXPENSE");
  const cogs = sumWhere((b) => b.type === "EXPENSE" && (b.code ?? "").startsWith("51"));
  const opex = expenseTotal - cogs;
  const grossProfit = revenue - cogs;
  const netProfit = revenue - expenseTotal;
  const rc = await resolveAccountCodes(orgId, ["1101", "1102", "1103", "1104", "2101"]);
  const cash = (byCode[rc["1101"]] ?? 0) + (byCode[rc["1102"]] ?? 0);
  const ar = byCode[rc["1103"]] ?? 0;
  const inventory = byCode[rc["1104"]] ?? 0;
  const currentAssets = sumWhere((b) => b.type === "ASSET" && (b.code ?? "").startsWith("11"));
  const currentLiabilities = sumWhere((b) => b.type === "LIABILITY" && (b.code ?? "").startsWith("21"));
  const totalLiabilities = sumWhere((b) => b.type === "LIABILITY");
  const equity = sumWhere((b) => b.type === "EQUITY") + netProfit;
  const ap = byCode[rc["2101"]] ? -byCode[rc["2101"]] : 0;

  const rows: (string | number)[][] = [
    ["السيولة", "النسبة الجارية", r2(currentAssets / currentLiabilities)],
    ["السيولة", "النسبة السريعة", r2((currentAssets - inventory) / currentLiabilities)],
    ["السيولة", "رأس المال العامل", r2(currentAssets - currentLiabilities)],
    ["السيولة", "النقدية والبنك", r2(cash)],
    ["الربحية", "هامش الربح الإجمالي %", pct(grossProfit / revenue)],
    ["الربحية", "هامش الربح الصافي %", pct(netProfit / revenue)],
    ["الربحية", "الإيراد", r2(revenue)],
    ["الربحية", "المصروفات التشغيلية", r2(opex)],
    ["الكفاءة والملاءة", "متوسط تحصيل الذمم (يوم)", r2(ar / (revenue / 365))],
    ["الكفاءة والملاءة", "متوسط سداد الموردين (يوم)", cogs > 0 ? r2(ap / (cogs / 365)) : "—"],
    ["الكفاءة والملاءة", "معدّل دوران المخزون", r2(cogs / inventory)],
    ["الكفاءة والملاءة", "الدين إلى حقوق الملكية", r2(totalLiabilities / equity)],
  ];

  return xlsxResponse({
    sheet: "المؤشرات المالية",
    filename: "financial-ratios",
    headers: ["المجموعة", "المؤشر", "القيمة"],
    rows,
    colWidths: [20, 34, 16],
  });
  });
}
