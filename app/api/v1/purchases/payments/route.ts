import { authorizeApi, isApiError, runAsErp } from "@/lib/erp/api-auth";
import { emitErpEvent } from "@/lib/erp/realtime";
import { createPaymentVoucherAction, confirmPaymentVoucherAction } from "@/app/actions/erp/payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/v1/purchases/payments — create a supplier payment voucher and post it in one step.
 *  Body: { supplierId, purchaseInvoiceId?, cashAccountId, amount, date, paymentMethod?, reference?, notes? }. */
export async function POST(req: Request) {
  const auth = await authorizeApi(req, "purchases.pay");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  const body = await req.json().catch(() => ({}));
  const r = await runAsErp(auth, async (): Promise<{ ok?: boolean; id?: string; error?: string }> => {
    const created = await createPaymentVoucherAction(body);
    if (created.error || !created.id) return { error: created.error ?? "تعذّر إنشاء السند" };
    const posted = await confirmPaymentVoucherAction(created.id);
    return posted.error ? { error: posted.error } : { ok: true, id: created.id };
  });
  if (r.error) return Response.json({ error: r.error }, { status: 400 });
  emitErpEvent(auth.orgId, { action: "CREATE", entity: "PAYMENT_VOUCHER", id: r.id });
  return Response.json({ data: { ok: true, id: r.id } });
}
