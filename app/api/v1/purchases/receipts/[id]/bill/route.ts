import { authorizeApi, isApiError, runAsErp } from "@/lib/erp/api-auth";
import { emitErpEvent } from "@/lib/erp/realtime";
import { convertReceiptToInvoiceAction } from "@/app/actions/erp/goods-receipts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/v1/purchases/receipts/:id/bill — create a DRAFT purchase invoice from a confirmed receipt. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await authorizeApi(req, "purchases.create");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  const r = await runAsErp(auth, () => convertReceiptToInvoiceAction(id));
  if (r.error) return Response.json({ error: r.error }, { status: 400 });
  emitErpEvent(auth.orgId, { action: "CREATE", entity: "PURCHASE_INVOICE", id: r.invoiceId });
  return Response.json({ data: { ok: true, invoiceId: r.invoiceId } });
}
