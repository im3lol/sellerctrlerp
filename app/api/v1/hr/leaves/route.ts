import { authorizeApi, isApiError, runAsErp } from "@/lib/erp/api-auth";
import { emitErpEvent } from "@/lib/erp/realtime";
import { leaveRequestList } from "@/lib/erp/mobile-lists";
import { createLeaveRequestAction } from "@/app/actions/erp/leave-requests";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/hr/leaves — leave requests. */
export async function GET(req: Request) {
  const auth = await authorizeApi(req, "hr.view");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  return Response.json({ data: await leaveRequestList(auth.orgId) });
}

/** POST /api/v1/hr/leaves — create a DRAFT leave request.
 *  Body: { employeeId, leaveType, startDate, endDate, reason? }. */
export async function POST(req: Request) {
  const auth = await authorizeApi(req, "hr.create");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  const body = await req.json().catch(() => ({}));
  const r = await runAsErp(auth, () => createLeaveRequestAction(body));
  if (r.error) return Response.json({ error: r.error }, { status: 400 });
  emitErpEvent(auth.orgId, { action: "CREATE", entity: "LEAVE_REQUEST" });
  return Response.json({ data: { ok: true } });
}
