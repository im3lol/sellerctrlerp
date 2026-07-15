import { authorizeApi, isApiError } from "@/lib/erp/api-auth";
import { partyDetail } from "@/lib/erp/mobile-lists";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/party/:type/:id — full editable fields for a supplier/customer. */
export async function GET(req: Request, ctx: { params: Promise<{ type: string; id: string }> }) {
  const { type, id } = await ctx.params;
  if (type !== "suppliers" && type !== "customers") return Response.json({ error: "not_found" }, { status: 404 });
  const perm = type === "suppliers" ? "purchases.view" : "sales.view";
  const auth = await authorizeApi(req, perm);
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  const d = await partyDetail(auth.orgId, type, id);
  if (!d) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json({ data: d });
}
