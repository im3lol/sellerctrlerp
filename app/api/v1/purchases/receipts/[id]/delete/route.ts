import { authorizeApi, isApiError, runAsErp } from "@/lib/erp/api-auth";
import { deleteReceiptAction } from "@/app/actions/erp/goods-receipts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/v1/purchases/receipts/:id/delete — delete a DRAFT goods receipt. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await authorizeApi(req, "purchases.create");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  const r = await runAsErp(auth, () => deleteReceiptAction(id));
  if (r.error) return Response.json({ error: r.error }, { status: 400 });
  return Response.json({ data: { ok: true } });
}
