import { postCountAction } from "@/app/actions/erp/cycle-count";
import { authorizeApi, isApiError, runAsErp } from "@/lib/erp/api-auth";
export const runtime = "nodejs";
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) { const a = await authorizeApi(req, "inventory.confirm"); if (isApiError(a)) return Response.json({ error: a.error }, { status: a.status }); const { id } = await params; return runAsErp(a, async () => { const r = await postCountAction(id); return Response.json(r, { status: r.ok ? 200 : 400 }); }); }
