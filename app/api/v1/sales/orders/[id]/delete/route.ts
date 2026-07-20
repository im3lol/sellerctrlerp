import { authorizeApi, isApiError, runAsErp } from "@/lib/erp/api-auth";
import { emitErpEvent } from "@/lib/erp/realtime";
import { deleteSalesOrderAction } from "@/app/actions/erp/sales-orders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/v1/sales/orders/:id/delete — delete a DRAFT sales order. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await authorizeApi(req, "sales.create");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  const r = await runAsErp(auth, () => deleteSalesOrderAction(id));
  if (r.error) return Response.json({ error: r.error }, { status: 400 });
  emitErpEvent(auth.orgId, { action: "DELETE", entity: "SALES_ORDER", id });
  return Response.json({ data: { ok: true } });
}
