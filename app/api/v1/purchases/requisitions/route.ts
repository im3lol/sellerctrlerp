import { authorizeApi, isApiError, runAsErp } from "@/lib/erp/api-auth";
import { createMaterialRequestAction } from "@/app/actions/erp/material-requests";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/purchases/requisitions — create a DRAFT material requisition.
 * Body: { date, notes?, lines: [{ itemId, quantity }] }.
 */
export async function POST(req: Request) {
  const auth = await authorizeApi(req, "purchases.create");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  const body = await req.json().catch(() => ({}));
  const r = await runAsErp(auth, () => createMaterialRequestAction(body));
  if (r.error) return Response.json({ error: r.error }, { status: 400 });
  return Response.json({ data: { ok: true, id: r.id } });
}
