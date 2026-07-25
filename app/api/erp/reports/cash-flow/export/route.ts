import { requireErpModule } from "@/lib/erp/org";
import { orgFiscalYearStartISO } from "@/lib/erp/fiscal";
import { getCashFlow } from "@/lib/erp/cashflow";
import { xlsxResponse } from "@/lib/erp/xlsx";

export const runtime = "nodejs";

/** Excel export of the (indirect-method) cash-flow statement for the period. */
export async function GET(req: Request) {
  const { orgId } = await requireErpModule("reports.view");
  const p = new URL(req.url).searchParams;
  const now = new Date();
  const from = p.get("from") || (await orgFiscalYearStartISO(orgId, now));
  const to = p.get("to") || now.toISOString().slice(0, 10);

  const cf = await getCashFlow(orgId, new Date(from), new Date(`${to}T23:59:59`));

  const rows: (string | number)[][] = [];
  rows.push(["تشغيلي", "", "صافي الربح / (الخسارة)", cf.netIncome]);
  cf.operating.forEach((l) => rows.push(["تشغيلي", l.code, l.nameAr, l.sign * l.amount]));
  rows.push(["", "", "صافي التدفق التشغيلي", cf.opTotal]);
  cf.investing.forEach((l) => rows.push(["استثماري", l.code, l.nameAr, l.sign * l.amount]));
  rows.push(["", "", "صافي التدفق الاستثماري", cf.invTotal]);
  cf.financing.forEach((l) => rows.push(["تمويلي", l.code, l.nameAr, l.sign * l.amount]));
  rows.push(["", "", "صافي التدفق التمويلي", cf.finTotal]);
  rows.push(["", "", "صافي التغيّر في النقدية", cf.netCashChange]);
  rows.push(["", "", "النقدية أول الفترة", cf.cashBegin]);

  return xlsxResponse({
    sheet: "التدفق النقدي",
    filename: `cash-flow-${from}_${to}`,
    headers: ["النشاط", "الكود", "البند", "المبلغ"],
    rows,
    totalRow: ["", "", "النقدية آخر الفترة", cf.cashEnd],
    colWidths: [14, 12, 34, 16],
  });
}
