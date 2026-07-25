import { authorizeApi, isApiError, runAsErp } from "@/lib/erp/api-auth";
import { fulfillOrder } from "@/lib/erp/fulfillment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/sales/orders/:id/fulfill — run the document cycle for a CONFIRMED
 * order: delivery note → confirm (stock OUT + COGS) → invoice → post (revenue + AR).
 * The inner actions enforce their own permissions against the caller's real set.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await authorizeApi(req, "sales.confirm");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  const r = await runAsErp(auth, () => fulfillOrder(auth.orgId, id, { mode: "invoice" }));
  if (!r.ok) return Response.json({ error: r.error }, { status: r.blocked ? 409 : 400 });
  return Response.json({ data: r });
}
