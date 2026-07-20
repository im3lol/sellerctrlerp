import { authorizeApi, isApiError } from "@/lib/erp/api-auth";
import { incomeStatement, balanceSheet, cashFlowStatement } from "@/lib/erp/mobile-reports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/financials/:key — income statement / balance sheet / cash flow.
 * Optional ?from=&to= (income, cash-flow) or ?asOf= (balance sheet); defaults to
 * year-to-date / today.
 */
export async function GET(req: Request, ctx: { params: Promise<{ key: string }> }) {
  const { key } = await ctx.params;
  const auth = await authorizeApi(req, "reports.view");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });

  const url = new URL(req.url);
  const from = url.searchParams.get("from") ?? undefined;
  const to = url.searchParams.get("to") ?? undefined;
  const asOf = url.searchParams.get("asOf") ?? undefined;

  switch (key) {
    case "income": return Response.json({ data: await incomeStatement(auth.orgId, from, to) });
    case "balance-sheet": return Response.json({ data: await balanceSheet(auth.orgId, asOf) });
    case "cash-flow": return Response.json({ data: await cashFlowStatement(auth.orgId, from, to) });
    default: return Response.json({ error: "not_found" }, { status: 404 });
  }
}
