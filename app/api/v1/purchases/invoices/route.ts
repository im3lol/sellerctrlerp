import { authorizeApi, isApiError } from "@/lib/erp/api-auth";
import { purchaseInvoiceList } from "@/lib/erp/mobile-lists";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await authorizeApi(req, "purchases.view");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  return Response.json({ data: await purchaseInvoiceList(auth.orgId) });
}

/**
 * POST is closed on purpose: a purchase invoice can only be raised from a confirmed
 * goods receipt, so there is a single costing path for the goods
 * (أمر شراء ← إذن استلام ← فاتورة). Create the receipt, then bill it.
 */
export async function POST(req: Request) {
  const auth = await authorizeApi(req, "purchases.create");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  return Response.json(
    { error: "فاتورة الشراء تُنشأ من إذن استلام مؤكّد فقط — الدورة: أمر شراء ← إذن استلام ← فاتورة" },
    { status: 400 },
  );
}
