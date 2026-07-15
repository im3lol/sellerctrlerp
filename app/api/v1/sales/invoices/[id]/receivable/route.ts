import { authorizeApi, isApiError } from "@/lib/erp/api-auth";
import { salesInvoiceReceivable } from "@/lib/erp/mobile-lists";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/sales/invoices/:id/receivable — customer + balance due for the collection form. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await authorizeApi(req, "sales.view");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  const r = await salesInvoiceReceivable(auth.orgId, id);
  if (!r) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json({ data: r });
}
