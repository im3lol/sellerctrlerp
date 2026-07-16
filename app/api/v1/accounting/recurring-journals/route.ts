import { authorizeApi, isApiError, runAsErp } from "@/lib/erp/api-auth";
import { emitErpEvent } from "@/lib/erp/realtime";
import { recurringJournalList } from "@/lib/erp/mobile-lists";
import { upsertRecurringJournalAction } from "@/app/actions/erp/recurring-journals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await authorizeApi(req, "accounting.view");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  return Response.json({ data: await recurringJournalList(auth.orgId) });
}

/** POST /api/v1/accounting/recurring-journals — create/update a recurring journal template.
 *  Body: { id?, name, description?, frequency, nextRunDate, lines:[{accountId,debit,credit,description?}] }. */
export async function POST(req: Request) {
  const auth = await authorizeApi(req, "accounting.create");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  const body = await req.json().catch(() => ({}));
  const r = await runAsErp(auth, () => upsertRecurringJournalAction(body));
  if (r.error) return Response.json({ error: r.error }, { status: 400 });
  emitErpEvent(auth.orgId, { action: body.id ? "UPDATE" : "CREATE", entity: "RECURRING_JOURNAL", id: r.id });
  return Response.json({ data: { ok: true, id: r.id } });
}
