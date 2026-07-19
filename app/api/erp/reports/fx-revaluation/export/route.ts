import { and, eq, gt, inArray, ne, sql } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { withOrgScope } from "@/lib/db-scope";
import { db } from "@/lib/db";
import { salesInvoices, purchaseInvoices } from "@/db/schema";
import { getBaseCurrencyCode } from "@/lib/erp/currency";
import { xlsxResponse } from "@/lib/erp/xlsx";

export const runtime = "nodejs";
const OPEN = ["POSTED", "PARTIAL_PAID"];
type Inv = { currencyCode: string; foreignAmount: string | null; totalAmount: string; balanceDue: string };
type Agg = { currency: string; kind: "AR" | "AP"; foreignRemaining: number; book: number; revalued: number };

/** Excel export of unrealised FX gains/losses on open foreign balances (real DB data). */
export async function GET() {
  const { orgId } = await requireErpModule("reports.view");
  const base = await getBaseCurrencyCode(orgId);

  return withOrgScope(orgId, false, async () => {
  const [rateRows, arRows, apRows] = await Promise.all([
    db.execute<{ currency_code: string; rate: string }>(sql`
      SELECT DISTINCT ON (currency_code) currency_code, rate
      FROM exchange_rates WHERE organization_id = ${orgId}
      ORDER BY currency_code, date DESC`),
    db.select({ currencyCode: salesInvoices.currencyCode, foreignAmount: salesInvoices.foreignAmount, totalAmount: salesInvoices.totalAmount, balanceDue: salesInvoices.balanceDue })
      .from(salesInvoices).where(and(eq(salesInvoices.organizationId, orgId), inArray(salesInvoices.status, OPEN), gt(salesInvoices.balanceDue, "0"), ne(salesInvoices.currencyCode, base))),
    db.select({ currencyCode: purchaseInvoices.currencyCode, foreignAmount: purchaseInvoices.foreignAmount, totalAmount: purchaseInvoices.totalAmount, balanceDue: purchaseInvoices.balanceDue })
      .from(purchaseInvoices).where(and(eq(purchaseInvoices.organizationId, orgId), inArray(purchaseInvoices.status, OPEN), gt(purchaseInvoices.balanceDue, "0"), ne(purchaseInvoices.currencyCode, base))),
  ]);

  const rate = new Map((rateRows.rows as { currency_code: string; rate: string }[]).map((r) => [r.currency_code, Number(r.rate)]));
  const aggregate = (rows: Inv[], kind: "AR" | "AP") => {
    const m = new Map<string, Agg>();
    for (const r of rows) {
      const total = Number(r.totalAmount), bal = Number(r.balanceDue), foreign = Number(r.foreignAmount ?? 0);
      if (total <= 0) continue;
      const foreignRemaining = foreign * (bal / total);
      const cur = rate.get(r.currencyCode);
      const revalued = cur ? foreignRemaining * cur : bal;
      const a = m.get(r.currencyCode) ?? { currency: r.currencyCode, kind, foreignRemaining: 0, book: 0, revalued: 0 };
      a.foreignRemaining += foreignRemaining; a.book += bal; a.revalued += revalued;
      m.set(r.currencyCode, a);
    }
    return [...m.values()];
  };

  const rows = [...aggregate(arRows as Inv[], "AR"), ...aggregate(apRows as Inv[], "AP")]
    .map((a) => ({ ...a, gain: a.kind === "AR" ? a.revalued - a.book : -(a.revalued - a.book) }))
    .sort((x, y) => Math.abs(y.gain) - Math.abs(x.gain));
  const netGain = rows.reduce((s, r) => s + r.gain, 0);
  const r2 = (n: number) => Math.round(n * 100) / 100;

  return xlsxResponse({
    sheet: "إعادة تقييم العملات",
    filename: "fx-revaluation",
    headers: ["العملة", "النوع", "المتبقي (عملة أجنبية)", "القيمة الدفترية", "القيمة المعاد تقييمها", "الربح/الخسارة"],
    rows: rows.map((a) => [a.currency, a.kind === "AR" ? "مدينة" : "دائنة", r2(a.foreignRemaining), r2(a.book), r2(a.revalued), r2(a.gain)]),
    totalRow: ["", "", "", "", "صافي الفرق", r2(netGain)],
    colWidths: [12, 10, 20, 18, 20, 16],
  });
  });
}
