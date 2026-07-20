import { authorizeApi, isApiError, runAsErp } from "@/lib/erp/api-auth";
import { emitErpEvent } from "@/lib/erp/realtime";
import { recurringExpenseList } from "@/lib/erp/mobile-lists";
import { upsertRecurringExpenseAction } from "@/app/actions/erp/recurring-expenses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await authorizeApi(req, "accounting.view");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  return Response.json({ data: await recurringExpenseList(auth.orgId) });
}

/** POST /api/v1/accounting/recurring-expenses — create/update a recurring expense template.
 *  Body: { id?, expenseAccountId, cashAccountId, amount, frequency, nextRunDate, paymentMethod?, payee?, notes? }. */
export async function POST(req: Request) {
  const auth = await authorizeApi(req, "accounting.create");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  const body = await req.json().catch(() => ({}));
  const r = await runAsErp(auth, () => upsertRecurringExpenseAction(body));
  if (r.error) return Response.json({ error: r.error }, { status: 400 });
  emitErpEvent(auth.orgId, { action: body.id ? "UPDATE" : "CREATE", entity: "RECURRING_EXPENSE", id: r.id });
  return Response.json({ data: { ok: true, id: r.id } });
}
