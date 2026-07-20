import { authorizeApi, isApiError, runAsErp } from "@/lib/erp/api-auth";
import { emitErpEvent } from "@/lib/erp/realtime";
import { searchItems } from "@/lib/erp/inventory-queries";
import { saveItemAction } from "@/app/actions/erp/items";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/inventory/items?q=… — search items (code/name/barcode) with on-hand. */
export async function GET(req: Request) {
  const auth = await authorizeApi(req, "inventory.view");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  const q = new URL(req.url).searchParams.get("q") ?? "";
  return Response.json({ data: await searchItems(auth.orgId, q) });
}

/** POST /api/v1/inventory/items — create/update an item.
 *  Body: { id?, code, nameAr, nameEn?, sellPrice?, minStock?, isPerishable?, codes?:[{codeType,code}] }. */
export async function POST(req: Request) {
  const auth = await authorizeApi(req, "inventory.create");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  const body = await req.json().catch(() => ({}));
  const r = await runAsErp(auth, () => saveItemAction(body));
  if (r.error) return Response.json({ error: r.error }, { status: 400 });
  emitErpEvent(auth.orgId, { action: body.id ? "UPDATE" : "CREATE", entity: "ITEM", id: r.id });
  return Response.json({ data: { ok: true, id: r.id } });
}
