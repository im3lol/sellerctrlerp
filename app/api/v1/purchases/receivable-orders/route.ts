import { authorizeApi, isApiError } from "@/lib/erp/api-auth";
import { receivablePurchaseOrders } from "@/lib/erp/mobile-lists";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/purchases/receivable-orders — confirmed/partial POs available to receive against. */
export async function GET(req: Request) {
  const auth = await authorizeApi(req, "purchases.view");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  return Response.json({ data: await receivablePurchaseOrders(auth.orgId) });
}
