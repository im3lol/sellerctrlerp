import { and, eq, sql } from "drizzle-orm";
import { authorizeApi, isApiError } from "@/lib/erp/api-auth";
import { emitErpEvent } from "@/lib/erp/realtime";
import { db } from "@/lib/db";
import { bankAccounts, bankStatementLines, salesPlatforms } from "@/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/v1/accounting/banks/:id/delete — delete a bank account, guarded by linked data. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await authorizeApi(req, "accounting.create");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  const [ba] = await db.select({ id: bankAccounts.id }).from(bankAccounts)
    .where(and(eq(bankAccounts.id, id), eq(bankAccounts.organizationId, auth.orgId)));
  if (!ba) return Response.json({ error: "الحساب البنكي غير موجود" }, { status: 404 });

  const [{ n: stmtCount }] = await db.select({ n: sql<number>`count(*)` }).from(bankStatementLines)
    .where(and(eq(bankStatementLines.bankAccountId, id), eq(bankStatementLines.organizationId, auth.orgId)));
  const platformRows = await db.select({ name: salesPlatforms.name }).from(salesPlatforms)
    .where(and(eq(salesPlatforms.bankAccountId, id), eq(salesPlatforms.organizationId, auth.orgId)));
  const linked: string[] = [];
  if (Number(stmtCount) > 0) linked.push(`${Number(stmtCount)} حركة كشف بنكي`);
  if (platformRows.length) linked.push(`منصات مرتبطة: ${platformRows.map((p) => p.name).join("، ")}`);
  if (linked.length) return Response.json({ error: `لا يمكن الحذف — الحساب مرتبط بـ: ${linked.join(" · ")}. أزِل الارتباط أولًا.` }, { status: 400 });

  await db.delete(bankAccounts).where(and(eq(bankAccounts.id, id), eq(bankAccounts.organizationId, auth.orgId)));
  emitErpEvent(auth.orgId, { action: "DELETE", entity: "BANK_ACCOUNT", id });
  return Response.json({ data: { ok: true } });
}
