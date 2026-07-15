import { authorizeApi, isApiError, runAsErp } from "@/lib/erp/api-auth";
import { emitErpEvent } from "@/lib/erp/realtime";
import { costCenterList } from "@/lib/erp/mobile-lists";
import { saveCostCenterAction } from "@/app/actions/erp/cost-centers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await authorizeApi(req, "accounting.view");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  return Response.json({ data: await costCenterList(auth.orgId) });
}

/** POST /api/v1/accounting/cost-centers — create/update a cost center.
 *  Body: { id?, code, nameAr, nameEn?, parentId?, isActive? }. */
export async function POST(req: Request) {
  const auth = await authorizeApi(req, "accounting.create");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  const b = await req.json().catch(() => ({}));
  const fd = new FormData();
  if (b.id) fd.set("id", String(b.id));
  fd.set("code", String(b.code ?? ""));
  fd.set("nameAr", String(b.nameAr ?? ""));
  if (b.nameEn) fd.set("nameEn", String(b.nameEn));
  if (b.parentId) fd.set("parentId", String(b.parentId));
  if (b.isActive !== false) fd.set("isActive", "on");
  const r = await runAsErp(auth, () => saveCostCenterAction({}, fd));
  if (r.error) return Response.json({ error: r.error }, { status: 400 });
  emitErpEvent(auth.orgId, { action: b.id ? "UPDATE" : "CREATE", entity: "COST_CENTER", id: b.id });
  return Response.json({ data: { ok: true } });
}
