import { authorizeApi, isApiError } from "@/lib/erp/api-auth";
import { requisitionDetail } from "@/lib/erp/mobile-lists";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/purchases/requisitions/:id — header + item lines. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await authorizeApi(req, "purchases.view");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  const d = await requisitionDetail(auth.orgId, id);
  if (!d) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json({ data: d });
}
