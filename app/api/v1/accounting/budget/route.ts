import { and, eq } from "drizzle-orm";
import { authorizeApi, isApiError } from "@/lib/erp/api-auth";
import { emitErpEvent } from "@/lib/erp/realtime";
import { db } from "@/lib/db";
import { accountBudgets, accounts } from "@/db/schema";
import { budgetYearList } from "@/lib/erp/mobile-lists";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/accounting/budget — budget years with count + total. */
export async function GET(req: Request) {
  const auth = await authorizeApi(req, "accounting.view");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  return Response.json({ data: await budgetYearList(auth.orgId) });
}

/** POST /api/v1/accounting/budget — upsert budget amounts for a year (direct core; the
 *  cookie action gates via requireErpModule). Body: { year, lines:[{accountId, amount}] }. */
export async function POST(req: Request) {
  const auth = await authorizeApi(req, "accounting.create");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  const b = await req.json().catch(() => ({}));
  const year = Number(b.year ?? 0);
  const lines: { accountId?: string; amount?: number }[] = Array.isArray(b.lines) ? b.lines : [];
  if (year < 2000 || year > 2100) return Response.json({ error: "سنة غير صالحة" }, { status: 400 });
  if (!lines.length) return Response.json({ error: "لا توجد بنود" }, { status: 400 });

  const orgAccounts = await db.select({ id: accounts.id }).from(accounts).where(eq(accounts.organizationId, auth.orgId));
  const valid = new Set(orgAccounts.map((a) => a.id));
  if (lines.some((l) => !l.accountId || !valid.has(l.accountId))) {
    return Response.json({ error: "حساب غير موجود في هذه المؤسسة" }, { status: 400 });
  }

  await db.transaction(async (tx) => {
    for (const l of lines) {
      await tx.insert(accountBudgets)
        .values({ organizationId: auth.orgId, year, accountId: l.accountId!, amount: String(Number(l.amount ?? 0)) })
        .onConflictDoUpdate({
          target: [accountBudgets.organizationId, accountBudgets.year, accountBudgets.accountId],
          set: { amount: String(Number(l.amount ?? 0)) },
        });
    }
  });
  emitErpEvent(auth.orgId, { action: "UPDATE", entity: "BUDGET", id: String(year) });
  return Response.json({ data: { ok: true } });
}
