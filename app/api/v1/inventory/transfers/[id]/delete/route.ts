import { authorizeApi, isApiError, runAsErp } from "@/lib/erp/api-auth";
import { deleteStockTransferAction } from "@/app/actions/erp/stock-transfers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/v1/inventory/transfers/:id/delete — delete a DRAFT transfer. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await authorizeApi(req, "inventory.create");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  const r = await runAsErp(auth, () => deleteStockTransferAction(id));
  if (r.error) return Response.json({ error: r.error }, { status: 400 });
  return Response.json({ data: { ok: true } });
}
