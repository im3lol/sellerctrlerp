import { authorizeApi, isApiError, runAsErp } from "@/lib/erp/api-auth";
import { confirmStockAdjustmentAction } from "@/app/actions/erp/stock-adjustments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/v1/inventory/adjustments/:id/confirm — post the ADJ movements + journal. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await authorizeApi(req, "inventory.confirm");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  const r = await runAsErp(auth, () => confirmStockAdjustmentAction(id));
  if (r.error) return Response.json({ error: r.error }, { status: 400 });
  return Response.json({ data: { ok: true } });
}
