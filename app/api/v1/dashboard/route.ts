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
      net: auth.can("accounting.view") ? ov.net : null,
      cash: auth.can("accounting.view") ? ov.cash : null,
      ar: auth.can("accounting.view") || auth.can("sales.view") ? ov.ar : null,
      ap: auth.can("accounting.view") || auth.can("purchases.create") ? ov.ap : null,
      inventoryValue: auth.can("accounting.view") || auth.can("purchases.create") ? ov.inventoryValue : null,
      salesMonth: auth.can("sales.view") ? ov.salesMonth : null,
      lowStock: auth.can("inventory.view") ? ov.lowStock : null,
      outOfStock: auth.can("inventory.view") ? ov.outOfStock : null,
      overdueAR: auth.can("sales.view") || auth.can("accounting.view") ? ov.overdueAR : null,
      expiredCount: auth.can("inventory.view") ? ov.expiredCount : null,
      nearExpiryCount: auth.can("inventory.view") ? ov.nearExpiryCount : null,
      pending: {
        jeDraft: auth.can("accounting.view") ? pending.jeDraft : null,
        siDraft: auth.can("sales.view") ? pending.siDraft : null,
        soAwaiting: auth.can("sales.view") ? pending.soAwaiting : null,
        piDraft: auth.can("purchases.create") || auth.can("accounting.view") ? pending.piDraft : null,
        poAwaiting: auth.can("purchases.view") ? pending.poAwaiting : null,
      },
      recentSales: auth.can("sales.view") ? ov.recentSales.map((r) => ({ number: r.number, name: r.customer, amount: r.amount })) : [],
    },
  });
}
