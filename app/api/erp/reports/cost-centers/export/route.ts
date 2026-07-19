import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { withOrgScope } from "@/lib/db-scope";
import { db } from "@/lib/db";
import { journalEntryLines, journalEntries, accounts, costCenters } from "@/db/schema";
import { xlsxResponse } from "@/lib/erp/xlsx";

export const runtime = "nodejs";

/** Excel export of P&L per cost center for the page's period (real DB data). */
export async function GET(req: Request) {
  const { orgId } = await requireErpModule("reports.view");
  const p = new URL(req.url).searchParams;
  const now = new Date();
  const from = p.get("from") || `${now.getFullYear()}-01-01`;
  const to = p.get("to") || now.toISOString().slice(0, 10);

  return withOrgScope(orgId, false, async () => {
  const raw = await db
    .select({
      code: costCenters.code, name: costCenters.nameAr,
      revenue: sql<string>`sum(case when ${accounts.type} = 'REVENUE' then ${journalEntryLines.credit} - ${journalEntryLines.debit} else 0 end)`,
      expense: sql<string>`sum(case when ${accounts.type} = 'EXPENSE' then ${journalEntryLines.debit} - ${journalEntryLines.credit} else 0 end)`,
    })
    .from(journalEntryLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalEntryLines.journalEntryId))
    .innerJoin(accounts, eq(accounts.id, journalEntryLines.accountId))
    .leftJoin(costCenters, eq(costCenters.id, journalEntryLines.costCenterId))
    .where(and(
      eq(journalEntries.organizationId, orgId), eq(journalEntries.status, "POSTED"),
      inArray(accounts.type, ["REVENUE", "EXPENSE"]),
      gte(journalEntries.date, new Date(from)), lte(journalEntries.date, new Date(to + "T23:59:59")),
    ))
    .groupBy(costCenters.id, costCenters.code, costCenters.nameAr);

  const list = raw.map((r) => {
    const revenue = Number(r.revenue ?? 0), expense = Number(r.expense ?? 0);
    return { name: `${r.code ? r.code + " " : ""}${r.name ?? "غير محدّد"}`, revenue, expense, net: revenue - expense, margin: revenue > 0 ? ((revenue - expense) / revenue) * 100 : 0 };
  }).sort((a, b) => b.net - a.net);

  const tRev = list.reduce((s, r) => s + r.revenue, 0);
  const tExp = list.reduce((s, r) => s + r.expense, 0);

  return xlsxResponse({
    sheet: "مراكز التكلفة",
    filename: `cost-centers-${from}_${to}`,
    headers: ["مركز التكلفة", "الإيراد", "المصروف", "الصافي", "الهامش %"],
    rows: list.map((r) => [r.name, r.revenue, r.expense, r.net, r.revenue > 0 ? Number(r.margin.toFixed(1)) : ""]),
    totalRow: ["الإجمالي", tRev, tExp, tRev - tExp, ""],
    colWidths: [30, 16, 16, 16, 10],
  });
  });
}
