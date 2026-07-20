import { authorizeApi, isApiError, runAsErp } from "@/lib/erp/api-auth";
import { emitErpEvent } from "@/lib/erp/realtime";
import { bundleList } from "@/lib/erp/mobile-lists";
import { setBundleComponentsAction } from "@/app/actions/erp/bundles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await authorizeApi(req, "inventory.view");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  return Response.json({ data: await bundleList(auth.orgId) });
}

/** POST /api/v1/inventory/bundles — set/replace a kit's bill of materials.
 *  Body: { parentItemId, components:[{componentItemId,quantity}] }. */
export async function POST(req: Request) {
  const auth = await authorizeApi(req, "inventory.create");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  const body = await req.json().catch(() => ({}));
  const r = await runAsErp(auth, () => setBundleComponentsAction(body));
  if (r.error) return Response.json({ error: r.error }, { status: 400 });
  emitErpEvent(auth.orgId, { action: "UPDATE", entity: "ITEM", id: body.parentItemId });
  return Response.json({ data: { ok: true } });
}
