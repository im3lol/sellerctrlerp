import { authorizeApi, isApiError, runAsErp } from "@/lib/erp/api-auth";
import { deleteSalesInvoiceAction } from "@/app/actions/erp/sales-invoices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/v1/sales/invoices/:id/delete — delete a DRAFT sales invoice. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await authorizeApi(req, "sales.create");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  const r = await runAsErp(auth, () => deleteSalesInvoiceAction(id));
  if (r.error) return Response.json({ error: r.error }, { status: 400 });
  return Response.json({ data: { ok: true } });
}
