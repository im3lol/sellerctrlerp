import { requireErpModule } from "@/lib/erp/org";
import { withOrgScope } from "@/lib/db-scope";
import { orgFiscalYearStartISO } from "@/lib/erp/fiscal";
import { accountBalances } from "@/lib/erp/financials";
import { xlsxResponse } from "@/lib/erp/xlsx";

export const runtime = "nodejs";

/** Excel export of the trial balance for the page's period. */
export async function GET(req: Request) {
  const { orgId } = await requireErpModule("reports.view");
  const p = new URL(req.url).searchParams;
  const now = new Date();

  const { from, to, balances } = await withOrgScope(orgId, false, async () => {
    const from = p.get("from") || (await orgFiscalYearStartISO(orgId, now));
    const to = p.get("to") || now.toISOString().slice(0, 10);
    const balances = await accountBalances({ orgId, from: new Date(from), to: new Date(`${to}T23:59:59`) });
    return { from, to, balances };
  });
  const lines = balances
    .filter((b) => b.debit !== 0 || b.credit !== 0)
    .map((b) => ({ code: b.code, nameAr: b.nameAr, debit: b.balance > 0 ? b.balance : 0, credit: b.balance < 0 ? -b.balance : 0 }));
  const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
  const totalCredit = lines.reduce((s, l) => s + l.credit, 0);

  const rows: (string | number)[][] = lines.map((l) => [l.code, l.nameAr, l.debit, l.credit]);

  return xlsxResponse({
    sheet: "ميزان المراجعة",
    filename: `trial-balance-${from}_${to}`,
    headers: ["الكود", "الحساب", "مدين", "دائن"],
    rows,
    totalRow: ["", "الإجمالي", totalDebit, totalCredit],
    colWidths: [12, 34, 16, 16],
  });
}
