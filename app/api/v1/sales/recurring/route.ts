import { authorizeApi, isApiError, runAsErp } from "@/lib/erp/api-auth";
import { emitErpEvent } from "@/lib/erp/realtime";
import { recurringSalesInvoiceList } from "@/lib/erp/mobile-lists";
import { upsertRecurringSalesInvoiceAction } from "@/app/actions/erp/recurring-sales-invoices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await authorizeApi(req, "sales.view");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  return Response.json({ data: await recurringSalesInvoiceList(auth.orgId) });
}

/** POST /api/v1/sales/recurring — create/update a recurring sales invoice template.
 *  Body: { id?, customerId, frequency, nextRunDate, notes?, lines:[{itemId,quantity,unitPrice,discountAmount?,taxAmount?}] }. */
export async function POST(req: Request) {
  const auth = await authorizeApi(req, "sales.create");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  const body = await req.json().catch(() => ({}));
  const r = await runAsErp(auth, () => upsertRecurringSalesInvoiceAction(body));
  if (r.error) return Response.json({ error: r.error }, { status: 400 });
  emitErpEvent(auth.orgId, { action: body.id ? "UPDATE" : "CREATE", entity: "RECURRING_SALES_INVOICE", id: r.id });
  return Response.json({ data: { ok: true, id: r.id } });
}
