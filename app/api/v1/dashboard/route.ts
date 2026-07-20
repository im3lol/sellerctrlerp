import { authorizeApi, isApiError } from "@/lib/erp/api-auth";
import { getErpOverview, getPendingWork } from "@/lib/erp/overview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/dashboard — headline KPIs + pending-work counts + recent docs. */
export async function GET(req: Request) {
  const auth = await authorizeApi(req, "reports.view");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  const [ov, pending] = await Promise.all([getErpOverview(auth.orgId), getPendingWork(auth.orgId)]);
  return Response.json({
    data: {
      net: ov.net, cash: ov.cash, ar: ov.ar, ap: ov.ap,
      inventoryValue: ov.inventoryValue, salesMonth: ov.salesMonth,
      lowStock: ov.lowStock, outOfStock: ov.outOfStock,
      overdueAR: ov.overdueAR, expiredCount: ov.expiredCount, nearExpiryCount: ov.nearExpiryCount,
      pending,
      recentSales: ov.recentSales.map((r) => ({ number: r.number, name: r.customer, amount: r.amount })),
    },
  });
}
