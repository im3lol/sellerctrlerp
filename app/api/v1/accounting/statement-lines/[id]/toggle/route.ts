import { and, eq } from "drizzle-orm";
import { authorizeApi, isApiError } from "@/lib/erp/api-auth";
import { emitErpEvent } from "@/lib/erp/realtime";
import { db } from "@/lib/db";
import { bankStatementLines } from "@/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/v1/accounting/statement-lines/:id/toggle — flip a line's reconciled flag. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await authorizeApi(req, "accounting.create");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  const [line] = await db.select({ isReconciled: bankStatementLines.isReconciled }).from(bankStatementLines)
    .where(and(eq(bankStatementLines.id, id), eq(bankStatementLines.organizationId, auth.orgId)));
  if (!line) return Response.json({ error: "السطر غير موجود" }, { status: 404 });
  await db.update(bankStatementLines).set({ isReconciled: !line.isReconciled })
    .where(and(eq(bankStatementLines.id, id), eq(bankStatementLines.organizationId, auth.orgId)));
  emitErpEvent(auth.orgId, { action: "UPDATE", entity: "BANK_STATEMENT_LINE", id });
  return Response.json({ data: { ok: true } });
}
