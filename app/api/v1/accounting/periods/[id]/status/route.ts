import { authorizeApi, isApiError, runAsErp } from "@/lib/erp/api-auth";
import { emitErpEvent } from "@/lib/erp/realtime";
import { setPeriodStatusAction } from "@/app/actions/erp/periods";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/v1/accounting/periods/:id/status — Body: { status: "OPEN"|"SOFT_CLOSED"|"CLOSED" }. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await authorizeApi(req, "accounting.post");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  const body = await req.json().catch(() => ({}));
  const r = await runAsErp(auth, () => setPeriodStatusAction(id, String(body.status ?? "")));
  if (r.error) return Response.json({ error: r.error }, { status: 400 });
  emitErpEvent(auth.orgId, { action: "UPDATE", entity: "FISCAL_PERIOD", id });
  return Response.json({ data: { ok: true } });
}
