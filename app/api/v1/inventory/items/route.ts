import { authorizeApi, isApiError } from "@/lib/erp/api-auth";
import { searchItems } from "@/lib/erp/inventory-queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/inventory/items?q=… — search items (code/name/barcode) with on-hand. */
export async function GET(req: Request) {
  const auth = await authorizeApi(req, "inventory.view");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  const q = new URL(req.url).searchParams.get("q") ?? "";
  return Response.json({ data: await searchItems(auth.orgId, q) });
}
