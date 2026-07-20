import { authorizeApi, isApiError, runAsErp } from "@/lib/erp/api-auth";
import { emitErpEvent } from "@/lib/erp/realtime";
import { stockTransferList } from "@/lib/erp/mobile-lists";
import { createStockTransferAction } from "@/app/actions/erp/stock-transfers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await authorizeApi(req, "inventory.view");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  return Response.json({ data: await stockTransferList(auth.orgId) });
}

/** POST /api/v1/inventory/transfers — create a DRAFT warehouse transfer.
 *  Body: { date, notes?, lines:[{itemId,fromWarehouseId,toWarehouseId,quantity}] }. */
export async function POST(req: Request) {
  const auth = await authorizeApi(req, "inventory.create");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  const body = await req.json().catch(() => ({}));
  const r = await runAsErp(auth, () => createStockTransferAction(body));
  if (r.error) return Response.json({ error: r.error }, { status: 400 });
  emitErpEvent(auth.orgId, { action: "CREATE", entity: "STOCK_TRANSFER", id: r.id });
  return Response.json({ data: { ok: true, id: r.id } });
}
