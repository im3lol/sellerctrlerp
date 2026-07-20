import { authorizeApi, isApiError, runAsErp } from "@/lib/erp/api-auth";
import { approveLeaveRequestAction } from "@/app/actions/erp/leave-requests";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/v1/hr/leaves/:id/approve — DRAFT → APPROVED. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await authorizeApi(req, "hr.post");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  const r = await runAsErp(auth, () => approveLeaveRequestAction(id));
  if (r.error) return Response.json({ error: r.error }, { status: 400 });
  return Response.json({ data: { ok: true } });
}
