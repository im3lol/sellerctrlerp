import { authorizeApi, isApiError } from "@/lib/erp/api-auth";
import { leaveRequestList } from "@/lib/erp/mobile-lists";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/hr/leaves — leave requests. */
export async function GET(req: Request) {
  const auth = await authorizeApi(req, "hr.view");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  return Response.json({ data: await leaveRequestList(auth.orgId) });
}
