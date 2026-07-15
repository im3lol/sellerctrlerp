import { authorizeApi, isApiError, runAsErp } from "@/lib/erp/api-auth";
import { deletePurchaseInvoiceAction } from "@/app/actions/erp/purchase-invoices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/v1/purchases/invoices/:id/delete — delete a DRAFT purchase invoice. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await authorizeApi(req, "purchases.create");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  const r = await runAsErp(auth, () => deletePurchaseInvoiceAction(id));
  if (r.error) return Response.json({ error: r.error }, { status: 400 });
  return Response.json({ data: { ok: true } });
}
