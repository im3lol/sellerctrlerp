import { authorizeApi, isApiError, runAsErp } from "@/lib/erp/api-auth";
import { emitErpEvent } from "@/lib/erp/realtime";
import { salesInvoiceList } from "@/lib/erp/mobile-lists";
import { createSalesInvoiceAction } from "@/app/actions/erp/sales-invoices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await authorizeApi(req, "sales.view");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  return Response.json({ data: await salesInvoiceList(auth.orgId) });
}

/** POST /api/v1/sales/invoices — standalone DRAFT sales invoice.
 *  Body: { customerId, warehouseId, date, notes?, lines:[{itemId,quantity,unitPrice,discountAmount?,taxAmount?}] }. */
export async function POST(req: Request) {
  const auth = await authorizeApi(req, "sales.create");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  const body = await req.json().catch(() => ({}));
  const r = await runAsErp(auth, () => createSalesInvoiceAction(body));
  if (r.error) return Response.json({ error: r.error }, { status: 400 });
  emitErpEvent(auth.orgId, { action: "CREATE", entity: "SALES_INVOICE", id: r.id });
  return Response.json({ data: { ok: true, id: r.id } });
}
