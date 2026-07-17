import { runAsErp } from "@/lib/erp/api-auth";
import { and, eq } from "drizzle-orm";
import { authorizeApi, isApiError } from "@/lib/erp/api-auth";
import { emitErpEvent } from "@/lib/erp/realtime";
import { db } from "@/lib/db";
import { bankAccounts, bankStatementLines } from "@/db/schema";
import { bankStatement } from "@/lib/erp/mobile-lists";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/accounting/banks/:id/statement — statement lines + reconciliation summary. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await authorizeApi(req, "accounting.view");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  return runAsErp(auth, async () => {
    const st = await bankStatement(auth.orgId, id);
    if (!st) return Response.json({ error: "not_found" }, { status: 404 });
    return Response.json({ data: st });
  });
}

/** POST /api/v1/accounting/banks/:id/statement — add a statement line (direct core; the
 *  cookie action gates via requireErpModule). Body: { date, description?, reference?, debit?, credit? }. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await authorizeApi(req, "accounting.create");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  return runAsErp(auth, async () => {
    const [ba] = await db.select({ id: bankAccounts.id }).from(bankAccounts)
      .where(and(eq(bankAccounts.id, id), eq(bankAccounts.organizationId, auth.orgId)));
    if (!ba) return Response.json({ error: "الحساب البنكي غير موجود" }, { status: 404 });
    const b = await req.json().catch(() => ({}));
    const debit = Number(b.debit ?? 0), credit = Number(b.credit ?? 0);
    if (debit === 0 && credit === 0) return Response.json({ error: "يجب إدخال مبلغ واحد على الأقل" }, { status: 400 });
    const date = new Date(String(b.date ?? ""));
    if (Number.isNaN(date.getTime())) return Response.json({ error: "التاريخ غير صالح" }, { status: 400 });
    await db.insert(bankStatementLines).values({
      organizationId: auth.orgId, bankAccountId: id, date,
      description: b.description?.trim() || null, reference: b.reference?.trim() || null,
      debit: String(debit), credit: String(credit),
    });
    emitErpEvent(auth.orgId, { action: "CREATE", entity: "BANK_STATEMENT_LINE", id });
    return Response.json({ data: { ok: true } });
  });
}
