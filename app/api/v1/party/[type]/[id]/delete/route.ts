import { authorizeApi, isApiError, runAsErp } from "@/lib/erp/api-auth";
import { emitErpEvent } from "@/lib/erp/realtime";
import { deleteSupplierAction } from "@/app/actions/erp/suppliers";
import { deleteCustomerAction } from "@/app/actions/erp/customers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/v1/party/:type/:id/delete — delete a supplier/customer. */
export async function POST(req: Request, ctx: { params: Promise<{ type: string; id: string }> }) {
  const { type, id } = await ctx.params;
  if (type !== "suppliers" && type !== "customers") return Response.json({ error: "not_found" }, { status: 404 });
  const perm = type === "suppliers" ? "purchases.view" : "sales.view";
  const auth = await authorizeApi(req, perm);
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  const action = type === "suppliers" ? deleteSupplierAction : deleteCustomerAction;
  const r = await runAsErp(auth, () => action(id));
  if (r.error) return Response.json({ error: r.error }, { status: 400 });
  emitErpEvent(auth.orgId, { action: "DELETE", entity: type === "suppliers" ? "SUPPLIER" : "CUSTOMER" });
  return Response.json({ data: { ok: true } });
}
