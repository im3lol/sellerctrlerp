import { getCountAction } from "@/app/actions/erp/cycle-count";
import { authorizeApi, isApiError, runAsErp } from "@/lib/erp/api-auth";
export const runtime = "nodejs"; export const dynamic = "force-dynamic";
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) { const a = await authorizeApi(req, "inventory.view"); if (isApiError(a)) return Response.json({ error: a.error }, { status: a.status }); const { id } = await params; return runAsErp(a, async () => { const r = await getCountAction(id); return Response.json({ data: r.detail ?? null, error: r.error }, { status: r.ok ? 200 : 404 }); }); }
