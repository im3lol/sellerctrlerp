import { and, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { orgFiscalYearStartISO } from "@/lib/erp/fiscal";
import { withOrgScope } from "@/lib/db-scope";
import { db } from "@/lib/db";
import { salesInvoices, salesInvoiceLines, items, stockMovements, salesReturns, salesReturnLines, platformItemFees } from "@/db/schema";
import { buildProfitability } from "@/lib/erp/profitability";
import { xlsxResponse } from "@/lib/erp/xlsx";

export const runtime = "nodejs";
const POSTED = ["POSTED", "PARTIAL_PAID", "PAID"];
const SALE_REFS = ["DELIVERY", "SALES_INVOICE", "SALES_RETURN"];

/** Excel export of product profitability for the period (real DB data). */
export async function GET(req: Request) {
  const { orgId } = await requireErpModule("reports.view");
  const p = new URL(req.url).searchParams;
  const now = new Date();
  const from = p.get("from") || (await orgFiscalYearStartISO(orgId, now));
  const to = p.get("to") || now.toISOString().slice(0, 10);
  const fromD = new Date(from), toD = new Date(to + "T23:59:59");

  return withOrgScope(orgId, false, async () => {
  const [revRows, cogsRows, returnRows, feeRows] = await Promise.all([
    db.select({ itemId: salesInvoiceLines.itemId, code: items.code, name: items.nameAr, qty: sql<string>`sum(${salesInvoiceLines.quantity})`, revenue: sql<string>`sum(${salesInvoiceLines.totalAmount} - ${salesInvoiceLines.taxAmount})` })
      .from(salesInvoiceLines)
      .innerJoin(salesInvoices, eq(salesInvoices.id, salesInvoiceLines.salesInvoiceId))
      .innerJoin(items, eq(items.id, salesInvoiceLines.itemId))
      .where(and(eq(salesInvoices.organizationId, orgId), inArray(salesInvoices.status, POSTED), gte(salesInvoices.date, fromD), lte(salesInvoices.date, toD)))
      .groupBy(salesInvoiceLines.itemId, items.code, items.nameAr),
    db.select({ itemId: stockMovements.itemId, cogs: sql<string>`sum(case when ${stockMovements.type} = 'OUT' then ${stockMovements.totalCost} else -${stockMovements.totalCost} end)` })
      .from(stockMovements)
      .where(and(eq(stockMovements.organizationId, orgId), inArray(stockMovements.referenceType, SALE_REFS), gte(stockMovements.date, fromD), lte(stockMovements.date, toD)))
      .groupBy(stockMovements.itemId),
    db.select({ itemId: salesReturnLines.itemId, revenue: sql<string>`sum(${salesReturnLines.totalAmount})` })
      .from(salesReturnLines)
      .innerJoin(salesReturns, eq(salesReturns.id, salesReturnLines.salesReturnId))
      .where(and(eq(salesReturns.organizationId, orgId), eq(salesReturns.status, "POSTED"), isNull(salesReturns.deliveryNoteId), gte(salesReturns.date, fromD), lte(salesReturns.date, toD)))
      .groupBy(salesReturnLines.itemId),
    db.select({ itemId: platformItemFees.itemId, totalFees: platformItemFees.totalFees })
      .from(platformItemFees).where(eq(platformItemFees.organizationId, orgId)),
  ]);

  const cogsByItem = new Map(cogsRows.map((r) => [r.itemId, Number(r.cogs ?? 0)]));
  const returnsByItem = new Map(returnRows.map((r) => [r.itemId, Number(r.revenue ?? 0)]));
  const feesByItem = new Map(feeRows.map((r) => [r.itemId, Number(r.totalFees ?? 0)]));
  const list = buildProfitability(
    revRows.map((r) => ({ itemId: r.itemId, code: r.code, name: r.name, qty: Number(r.qty ?? 0), revenue: Number(r.revenue ?? 0) })),
    returnsByItem, cogsByItem, feesByItem,
  ).sort((a, b) => b.profit - a.profit);

  const tRev = list.reduce((s, r) => s + r.revenue, 0);
  const tCogs = list.reduce((s, r) => s + r.cogs, 0);
  const tFees = list.reduce((s, r) => s + r.fees, 0);

  return xlsxResponse({
    sheet: "ربحية المنتجات",
    filename: `profitability-${from}_${to}`,
    headers: ["الكود", "الصنف", "الكمية", "الإيراد", "التكلفة", "الربح", "الهامش %", "رسوم أمازون المقدرة", "الصافي بعد الرسوم"],
    rows: list.map((r) => [r.code, r.name, r.qty, r.revenue, r.cogs, r.profit, r.revenue > 0 ? Number(r.margin.toFixed(1)) : "", r.fees, r.netProfit]),
    totalRow: ["", "الإجمالي", "", tRev, tCogs, tRev - tCogs, "", tFees, tRev - tCogs - tFees],
    colWidths: [12, 28, 12, 16, 16, 16, 10, 16, 16],
  });
  });
}
