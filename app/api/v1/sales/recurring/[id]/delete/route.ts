import { authorizeApi, isApiError, runAsErp } from "@/lib/erp/api-auth";
import { emitErpEvent } from "@/lib/erp/realtime";
import { deleteRecurringSalesInvoiceAction } from "@/app/actions/erp/recurring-sales-invoices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/v1/sales/recurring/:id/delete — delete a recurring template. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await authorizeApi(req, "sales.create");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  const r = await runAsErp(auth, () => deleteRecurringSalesInvoiceAction(id));
  if (r.error) return Response.json({ error: r.error }, { status: 400 });
  emitErpEvent(auth.orgId, { action: "DELETE", entity: "RECURRING_SALES_INVOICE", id });
  return Response.json({ data: { ok: true } });
}
