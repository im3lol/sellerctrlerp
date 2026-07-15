import { authorizeApi, isApiError, runAsErp } from "@/lib/erp/api-auth";
import { emitErpEvent } from "@/lib/erp/realtime";
import { receiptVoucherList } from "@/lib/erp/mobile-lists";
import { createReceiptVoucherAction, confirmReceiptVoucherAction } from "@/app/actions/erp/receipts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await authorizeApi(req, "sales.view");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  return Response.json({ data: await receiptVoucherList(auth.orgId) });
}

/** POST /api/v1/sales/receipts — create a customer receipt voucher (سند قبض) and post it.
 *  Body: { customerId, salesInvoiceId?, cashAccountId, amount, date, paymentMethod?, reference?, notes? }. */
export async function POST(req: Request) {
  const auth = await authorizeApi(req, "sales.collect");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  const body = await req.json().catch(() => ({}));
  const r = await runAsErp(auth, async (): Promise<{ ok?: boolean; id?: string; error?: string }> => {
    const created = await createReceiptVoucherAction(body);
    if (created.error || !created.id) return { error: created.error ?? "تعذّر إنشاء السند" };
    const posted = await confirmReceiptVoucherAction(created.id);
    return posted.error ? { error: posted.error } : { ok: true, id: created.id };
  });
  if (r.error) return Response.json({ error: r.error }, { status: 400 });
  emitErpEvent(auth.orgId, { action: "CREATE", entity: "RECEIPT_VOUCHER", id: r.id });
  return Response.json({ data: { ok: true, id: r.id } });
}
