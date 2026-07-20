import { authorizeApi, isApiError, runAsErp } from "@/lib/erp/api-auth";
import { emitErpEvent } from "@/lib/erp/realtime";
import { expenseList } from "@/lib/erp/mobile-lists";
import { createExpenseAction } from "@/app/actions/erp/expenses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await authorizeApi(req, "accounting.view");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  return Response.json({ data: await expenseList(auth.orgId) });
}

/** POST /api/v1/accounting/expenses — create a DRAFT expense.
 *  Body: { expenseAccountId, cashAccountId, amount, date, paymentMethod?, payee?, reference?, notes? }. */
export async function POST(req: Request) {
  const auth = await authorizeApi(req, "accounting.create");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  const body = await req.json().catch(() => ({}));
  const r = await runAsErp(auth, () => createExpenseAction(body));
  if (r.error) return Response.json({ error: r.error }, { status: 400 });
  emitErpEvent(auth.orgId, { action: "CREATE", entity: "EXPENSE", id: r.id });
  return Response.json({ data: { ok: true, id: r.id } });
}
