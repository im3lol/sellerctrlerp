import { authorizeApi, isApiError } from "@/lib/erp/api-auth";
import { scanItem } from "@/lib/erp/inventory-queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/inventory/scan?code=… — exact barcode/SKU lookup → item + stock. */
export async function GET(req: Request) {
  const auth = await authorizeApi(req, "inventory.view");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  const code = new URL(req.url).searchParams.get("code") ?? "";
  const item = await scanItem(auth.orgId, code);
  if (!item) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json({ data: item });
}
