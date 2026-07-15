import { authorizeApi, isApiError, runAsErp } from "@/lib/erp/api-auth";
import { emitErpEvent } from "@/lib/erp/realtime";
import { salesOrderList } from "@/lib/erp/mobile-lists";
import { createSalesOrderAction } from "@/app/actions/erp/sales-orders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await authorizeApi(req, "sales.view");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  return Response.json({ data: await salesOrderList(auth.orgId) });
}

/** POST /api/v1/sales/orders — create a DRAFT sales order.
 *  Body: { customerId, date, dueDate?, notes?, shippingAmount?, lines:[{itemId,warehouseId?,quantity,unitPrice,discountAmount?,taxAmount?}] }. */
export async function POST(req: Request) {
  const auth = await authorizeApi(req, "sales.create");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  const body = await req.json().catch(() => ({}));
  const r = await runAsErp(auth, () => createSalesOrderAction(body));
  if (r.error) return Response.json({ error: r.error }, { status: 400 });
  emitErpEvent(auth.orgId, { action: "CREATE", entity: "SALES_ORDER", id: r.id });
  return Response.json({ data: { ok: true, id: r.id } });
}
