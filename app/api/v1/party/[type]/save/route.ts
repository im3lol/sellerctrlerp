import { authorizeApi, isApiError, runAsErp } from "@/lib/erp/api-auth";
import { emitErpEvent } from "@/lib/erp/realtime";
import { saveSupplierAction } from "@/app/actions/erp/suppliers";
import { saveCustomerAction } from "@/app/actions/erp/customers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/party/:type/save — create (no id) or update (with id) a supplier/
 * customer. JSON body → FormData → the existing cookie action via runAsErp, which
 * enforces purchases/sales create-vs-edit permission itself.
 */
export async function POST(req: Request, ctx: { params: Promise<{ type: string }> }) {
  const { type } = await ctx.params;
  if (type !== "suppliers" && type !== "customers") return Response.json({ error: "not_found" }, { status: 404 });
  const perm = type === "suppliers" ? "purchases.view" : "sales.view";
  const auth = await authorizeApi(req, perm);
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const fd = new FormData();
  for (const k of ["id", "code", "nameAr", "phone", "email", "paymentTerms", "creditLimit"]) {
    const v = body[k];
    if (v != null && v !== "") fd.set(k, String(v));
  }
  const action = type === "suppliers" ? saveSupplierAction : saveCustomerAction;
  const r = await runAsErp(auth, () => action({}, fd));
  if (r.error) return Response.json({ error: r.error }, { status: 400 });
  emitErpEvent(auth.orgId, { action: "UPDATE", entity: type === "suppliers" ? "SUPPLIER" : "CUSTOMER" });
  return Response.json({ data: { ok: true } });
}
