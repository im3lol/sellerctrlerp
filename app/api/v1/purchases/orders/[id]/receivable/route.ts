import { authorizeApi, isApiError, runAsErp } from "@/lib/erp/api-auth";
import { getReceivableOrderLinesAction } from "@/app/actions/erp/goods-receipts";
import { canReadPurchaseCosts } from "@/lib/erp/data-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/purchases/orders/:id/receivable — a PO's still-unreceived lines (remaining qty per item). */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await authorizeApi(req, "purchases.view");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  const r = await runAsErp(auth, () => getReceivableOrderLinesAction(id));
  if (r.error) return Response.json({ error: r.error }, { status: 400 });
  const lines = canReadPurchaseCosts(auth.can) ? r.lines ?? [] : (r.lines ?? []).map(l => ({
    itemId: l.itemId, code: l.code, name: l.name, image: l.image,
    ordered: l.ordered, received: l.received, remaining: l.remaining,
    stockByWarehouse: l.stockByWarehouse, isPerishable: l.isPerishable,
    shelfLifeDays: l.shelfLifeDays, weightKg: l.weightKg, unitPrice: null, poShippingPerUnit: null,
  }));
  return Response.json({ data: { lines, defaultWarehouseId: r.defaultWarehouseId ?? null } });
}
