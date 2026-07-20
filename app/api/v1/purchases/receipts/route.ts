import { authorizeApi, isApiError, runAsErp } from "@/lib/erp/api-auth";
import { emitErpEvent } from "@/lib/erp/realtime";
import { purchaseReceiptList } from "@/lib/erp/mobile-lists";
import { createReceiptFromOrderAction, type Pick } from "@/app/actions/erp/goods-receipts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await authorizeApi(req, "purchases.view");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  return Response.json({ data: await purchaseReceiptList(auth.orgId) });
}

/** POST /api/v1/purchases/receipts — create a DRAFT goods receipt from a confirmed PO.
 *  Body: { purchaseOrderId, date?, picks?: [{ itemId, quantity, rejectedQty? }] }. Omit picks → receive all remaining. */
export async function POST(req: Request) {
  const auth = await authorizeApi(req, "purchases.create");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  const body = await req.json().catch(() => ({}));
  const poId = String(body.purchaseOrderId ?? "");
  if (!poId) return Response.json({ error: "أمر الشراء مطلوب" }, { status: 400 });
  const picks: Pick[] | undefined = Array.isArray(body.picks) ? body.picks : undefined;
  const r = await runAsErp(auth, () => createReceiptFromOrderAction(poId, picks, body.date));
  if (r.error) return Response.json({ error: r.error }, { status: 400 });
  emitErpEvent(auth.orgId, { action: "CREATE", entity: "GOODS_RECEIPT", id: r.id });
  return Response.json({ data: { ok: true, id: r.id } });
}
