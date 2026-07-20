import { authorizeApi, isApiError, runAsErp } from "@/lib/erp/api-auth";
import { emitErpEvent } from "@/lib/erp/realtime";
import { employeeList } from "@/lib/erp/mobile-lists";
import { upsertEmployeeAction } from "@/app/actions/erp/payroll";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await authorizeApi(req, "hr.view");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  return Response.json({ data: await employeeList(auth.orgId) });
}

/** POST /api/v1/hr/employees — create/update a payroll employee.
 *  Body: { id?, fullName, employeeCode?, position?, department?, payType, basicSalary, allowances?, deductions?, taxRate?, hiredAt?, notes? }. */
export async function POST(req: Request) {
  const auth = await authorizeApi(req, "hr.create");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  const body = await req.json().catch(() => ({}));
  const r = await runAsErp(auth, () => upsertEmployeeAction({ ...body, userId: null }));
  if (r.error) return Response.json({ error: r.error }, { status: 400 });
  emitErpEvent(auth.orgId, { action: body.id ? "UPDATE" : "CREATE", entity: "EMPLOYEE", id: body.id });
  return Response.json({ data: { ok: true } });
}
