import { authorizeApi, isApiError, runAsErp } from "@/lib/erp/api-auth";
import { emitErpEvent } from "@/lib/erp/realtime";
import { payrollRunList } from "@/lib/erp/mobile-lists";
import { createPayrollRunAction } from "@/app/actions/erp/payroll";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await authorizeApi(req, "hr.view");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  return Response.json({ data: await payrollRunList(auth.orgId) });
}

/** POST /api/v1/hr/payroll — create a DRAFT payroll run for a period (auto-builds lines
 *  from active employees). Body: { periodStart, periodEnd, paymentDate?, notes? }. */
export async function POST(req: Request) {
  const auth = await authorizeApi(req, "hr.create");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  const body = await req.json().catch(() => ({}));
  const r = await runAsErp(auth, () => createPayrollRunAction(body));
  if (r.error) return Response.json({ error: r.error }, { status: 400 });
  emitErpEvent(auth.orgId, { action: "CREATE", entity: "PAYROLL_RUN", id: r.id });
  return Response.json({ data: { ok: true, id: r.id } });
}
