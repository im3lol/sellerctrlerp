import { authorizeApi, isApiError, runAsErp } from "@/lib/erp/api-auth";
import { emitErpEvent } from "@/lib/erp/realtime";
import { deleteItemAction } from "@/app/actions/erp/items";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/v1/inventory/items/:id/delete — delete an item (guarded by movements/links). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await authorizeApi(req, "inventory.delete");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  const r = await runAsErp(auth, () => deleteItemAction(id));
  if (r.error) return Response.json({ error: r.error }, { status: 400 });
  emitErpEvent(auth.orgId, { action: "DELETE", entity: "ITEM", id });
  return Response.json({ data: { ok: true } });
}
