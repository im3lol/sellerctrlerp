import { authorizeApi, isApiError, runAsErp } from "@/lib/erp/api-auth";
import { emitErpEvent } from "@/lib/erp/realtime";
import { journalList } from "@/lib/erp/mobile-lists";
import { createManualEntryAction } from "@/app/actions/erp/journal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await authorizeApi(req, "accounting.view");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  return Response.json({ data: await journalList(auth.orgId) });
}

/** POST /api/v1/accounting/journal — create a manual entry (DRAFT or posted).
 *  Body: { date, description, reference?, mode:"draft"|"post", lines:[{accountId,debit,credit,description?}] }. */
export async function POST(req: Request) {
  const auth = await authorizeApi(req, "accounting.create");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  const body = await req.json().catch(() => ({}));
  const r = await runAsErp(auth, () => createManualEntryAction(body));
  if (r.error) return Response.json({ error: r.error }, { status: 400 });
  emitErpEvent(auth.orgId, { action: "CREATE", entity: "JOURNAL_ENTRY", id: r.id });
  return Response.json({ data: { ok: true, id: r.id } });
}
