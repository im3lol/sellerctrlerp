import { authorizeApi, isApiError, runAsErp } from "@/lib/erp/api-auth";
import { emitErpEvent } from "@/lib/erp/realtime";
import { assembleAction } from "@/app/actions/erp/bundles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/v1/inventory/bundles/assemble — assemble kits (consume components, produce kit).
 *  Body: { kitItemId, warehouseId, quantity, date, notes? }. */
export async function POST(req: Request) {
  const auth = await authorizeApi(req, "inventory.confirm");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  const body = await req.json().catch(() => ({}));
  const r = await runAsErp(auth, () => assembleAction(body));
  if (r.error) return Response.json({ error: r.error }, { status: 400 });
  emitErpEvent(auth.orgId, { action: "CREATE", entity: "STOCK_ASSEMBLY", id: r.id });
  return Response.json({ data: { ok: true, id: r.id } });
}
