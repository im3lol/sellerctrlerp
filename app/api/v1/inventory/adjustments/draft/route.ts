import { authorizeApi, isApiError, runAsErp } from "@/lib/erp/api-auth";
import { emitErpEvent } from "@/lib/erp/realtime";
import { createStockAdjustmentAction } from "@/app/actions/erp/stock-adjustments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/v1/inventory/adjustments/draft — create a DRAFT adjustment document (not posted).
 *  Body: { date, reason?, notes?, lines:[{itemId,warehouseId,mode:"set"|"delta",value,unitCost?}] }. */
export async function POST(req: Request) {
  const auth = await authorizeApi(req, "inventory.create");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  const body = await req.json().catch(() => ({}));
  const r = await runAsErp(auth, () => createStockAdjustmentAction(body));
  if (r.error) return Response.json({ error: r.error }, { status: 400 });
  emitErpEvent(auth.orgId, { action: "CREATE", entity: "STOCK_ADJUSTMENT", id: r.id });
  return Response.json({ data: { ok: true, id: r.id } });
}
