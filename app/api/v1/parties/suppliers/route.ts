import { authorizeApi, isApiError } from "@/lib/erp/api-auth";
import { supplierList } from "@/lib/erp/mobile-lists";
import { purchaseRowsForCaller } from "@/lib/erp/data-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await authorizeApi(req, "purchases.view");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  return Response.json({ data: purchaseRowsForCaller(await supplierList(auth.orgId), auth.can) });
}
