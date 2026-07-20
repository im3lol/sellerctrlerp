import { authorizeApi, isApiError } from "@/lib/erp/api-auth";
import { getErpOverview } from "@/lib/erp/overview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/reports — income-statement + receivables/payables summary. */
export async function GET(req: Request) {
  const auth = await authorizeApi(req, "reports.view");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  const ov = await getErpOverview(auth.orgId);
  return Response.json({
    data: {
      income: ov.income, expense: ov.expense, net: ov.net,
      ar: ov.ar, ap: ov.ap, overdueAR: ov.overdueAR, overdueAP: ov.overdueAP,
      inventoryValue: ov.inventoryValue, salesMonth: ov.salesMonth, purchasesMonth: ov.purchasesMonth,
    },
  });
}
