import { authorizeApi, isApiError } from "@/lib/erp/api-auth";
import { listWarehouses } from "@/lib/erp/inventory-queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/inventory/warehouses — active warehouses (for pickers). */
export async function GET(req: Request) {
  const auth = await authorizeApi(req, "inventory.view");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  return Response.json({ data: await listWarehouses(auth.orgId) });
}
