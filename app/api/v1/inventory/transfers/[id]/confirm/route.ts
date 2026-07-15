import { authorizeApi, isApiError, runAsErp } from "@/lib/erp/api-auth";
import { confirmStockTransferAction } from "@/app/actions/erp/stock-transfers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/v1/inventory/transfers/:id/confirm — DRAFT → posts stock OUT source + IN destination. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await authorizeApi(req, "inventory.confirm");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  const r = await runAsErp(auth, () => confirmStockTransferAction(id));
  if (r.error) return Response.json({ error: r.error }, { status: 400 });
  return Response.json({ data: { ok: true } });
}
