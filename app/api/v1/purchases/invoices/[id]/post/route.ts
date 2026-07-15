import { authorizeApi, isApiError, runAsErp } from "@/lib/erp/api-auth";
import { postPurchaseInvoiceAction } from "@/app/actions/erp/purchase-invoices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/v1/purchases/invoices/:id/post — DRAFT → POSTED (Dr inventory/GRNI + tax · Cr AP; supplier balance). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await authorizeApi(req, "accounting.post");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  const r = await runAsErp(auth, () => postPurchaseInvoiceAction(id));
  if (r.error) return Response.json({ error: r.error }, { status: 400 });
  return Response.json({ data: { ok: true } });
}
