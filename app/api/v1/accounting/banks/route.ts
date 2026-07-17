import { runAsErp } from "@/lib/erp/api-auth";
import { and, eq } from "drizzle-orm";
import { authorizeApi, isApiError } from "@/lib/erp/api-auth";
import { emitErpEvent } from "@/lib/erp/realtime";
import { db } from "@/lib/db";
import { bankAccounts } from "@/db/schema";
import { bankAccountList } from "@/lib/erp/mobile-lists";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await authorizeApi(req, "accounting.view");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  return runAsErp(auth, async () => {
    return Response.json({ data: await bankAccountList(auth.orgId) });
  });
}

/** POST /api/v1/accounting/banks — create/update a bank account.
 *  Body: { id?, nameAr, bankName?, accountNumber?, iban?, glAccountId?, notes? }. Direct core
 *  (the cookie action gates via requireErpModule, unusable from the bearer API). */
export async function POST(req: Request) {
  const auth = await authorizeApi(req, "accounting.create");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  return runAsErp(auth, async () => {
    const b = await req.json().catch(() => ({}));
    const nameAr = String(b.nameAr ?? "").trim();
    if (!nameAr) return Response.json({ error: "اسم الحساب مطلوب" }, { status: 400 });
    const values = {
      organizationId: auth.orgId, nameAr,
      bankName: b.bankName?.trim() || null, accountNumber: b.accountNumber?.trim() || null,
      iban: b.iban?.trim() || null, glAccountId: b.glAccountId || null, notes: b.notes?.trim() || null, updatedAt: new Date(),
    };
    let id: string;
    if (b.id) {
      await db.update(bankAccounts).set(values).where(and(eq(bankAccounts.id, b.id), eq(bankAccounts.organizationId, auth.orgId)));
      id = b.id;
    } else {
      const [row] = await db.insert(bankAccounts).values(values).returning({ id: bankAccounts.id });
      id = row.id;
    }
    emitErpEvent(auth.orgId, { action: b.id ? "UPDATE" : "CREATE", entity: "BANK_ACCOUNT", id });
    return Response.json({ data: { ok: true, id } });
  });
}
