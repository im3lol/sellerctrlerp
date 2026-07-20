import { authorizeApi, isApiError } from "@/lib/erp/api-auth";
import { deliveryList } from "@/lib/erp/mobile-lists";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await authorizeApi(req, "sales.view");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  return Response.json({ data: await deliveryList(auth.orgId) });
}
