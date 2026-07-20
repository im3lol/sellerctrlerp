import { authorizeApi, isApiError, runAsErp } from "@/lib/erp/api-auth";
import { emitErpEvent } from "@/lib/erp/realtime";
import { approveMaterialRequestAction } from "@/app/actions/erp/material-requests";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/v1/purchases/requisitions/:id/approve — DRAFT → APPROVED. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await authorizeApi(req, "purchases.confirm");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  const r = await runAsErp(auth, () => approveMaterialRequestAction(id));
  if (r.error) return Response.json({ error: r.error }, { status: 400 });
  emitErpEvent(auth.orgId, { action: "CONFIRM", entity: "MATERIAL_REQUEST", id });
  return Response.json({ data: { ok: true } });
}
