import { generateCountAction, listCountsAction } from "@/app/actions/erp/cycle-count";
import { authorizeApi, isApiError, runAsErp } from "@/lib/erp/api-auth";
export const runtime = "nodejs"; export const dynamic = "force-dynamic";
export async function GET(req: Request) { const a = await authorizeApi(req, "inventory.view"); if (isApiError(a)) return Response.json({ error: a.error }, { status: a.status }); return runAsErp(a, async () => { const r = await listCountsAction(); return Response.json({ data: r.rows ?? [], error: r.error }); }); }
export async function POST(req: Request) { const a = await authorizeApi(req, "inventory.create"); if (isApiError(a)) return Response.json({ error: a.error }, { status: a.status }); const body = await req.json().catch(() => null); return runAsErp(a, async () => { const r = await generateCountAction(body); return Response.json(r, { status: r.ok ? 200 : 400 }); }); }
