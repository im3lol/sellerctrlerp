import { authorizeApi, isApiError, runAsErp } from "@/lib/erp/api-auth";
import { emitErpEvent } from "@/lib/erp/realtime";
import { purchaseOrderList } from "@/lib/erp/mobile-lists";
import { createPurchaseOrderAction } from "@/app/actions/erp/purchase-orders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await authorizeApi(req, "purchases.view");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  return Response.json({ data: await purchaseOrderList(auth.orgId) });
}

/** POST /api/v1/purchases/orders — create a DRAFT PO. Body: { supplierId, warehouseId, date, notes?, lines:[{itemId,quantity,unitPrice}] }. */
export async function POST(req: Request) {
  const auth = await authorizeApi(req, "purchases.create");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  const body = await req.json().catch(() => ({}));
  const r = await runAsErp(auth, () => createPurchaseOrderAction(body));
  if (r.error) return Response.json({ error: r.error }, { status: 400 });
  emitErpEvent(auth.orgId, { action: "CREATE", entity: "PURCHASE_ORDER", id: r.id });
  return Response.json({ data: { ok: true, id: r.id } });
}
