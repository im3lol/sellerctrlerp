"use server";

import { withOrgScope } from "@/lib/db-scope";
import { revalidatePath } from "@/lib/safe-revalidate";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { recurringJournals, recurringJournalLines, accounts } from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";
import { FREQUENCIES } from "@/lib/erp/recurring-shared";
import { bulkRun, type BulkResult } from "@/lib/erp/bulk-delete";

type Res = ActionState & { id?: string };
const cents = (n: number) => Math.round((Number(n) || 0) * 100);

const schema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(2, "اسم القالب مطلوب"),
  description: z.string().optional(),
  frequency: z.enum(["WEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"]),
  nextRunDate: z.string().min(1, "تاريخ أول تنفيذ مطلوب"),
  lines: z.array(z.object({
    accountId: z.string().min(1),
    debit: z.coerce.number().min(0).default(0),
    credit: z.coerce.number().min(0).default(0),
    description: z.string().optional(),
  })).min(2, "أضف بندين على الأقل"),
});

export async function upsertRecurringJournalAction(input: unknown): Promise<Res> {
  const auth = await authorizeErp("accounting.create");
  if ("error" in auth) return auth;
  return withOrgScope(auth.orgId, false, async () => {
    const parsed = schema.safeParse(input);
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const d = parsed.data;
    if (!(FREQUENCIES as string[]).includes(d.frequency)) return { error: "تكرار غير صحيح" };

    const lines = d.lines.filter((l) => cents(l.debit) !== 0 || cents(l.credit) !== 0);
    if (lines.length < 2) return { error: "أضف بندين بقيمة على الأقل" };
    if (lines.some((l) => cents(l.debit) !== 0 && cents(l.credit) !== 0)) return { error: "كل بند إما مدين أو دائن، وليس الاثنين" };
    const totDr = lines.reduce((s, l) => s + cents(l.debit), 0);
    const totCr = lines.reduce((s, l) => s + cents(l.credit), 0);
    if (totDr === 0) return { error: "القيد بقيمة صفر" };
    if (totDr !== totCr) return { error: `القيد غير متوازن (مدين ${(totDr / 100).toFixed(2)} ≠ دائن ${(totCr / 100).toFixed(2)})` };

    const accIds = [...new Set(lines.map((l) => l.accountId))];
    const found = await db.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.organizationId, auth.orgId), inArray(accounts.id, accIds)));
    if (found.length !== accIds.length) return { error: "حساب غير موجود في هذه المؤسسة" };

    const nextRun = new Date(d.nextRunDate);
    if (isNaN(nextRun.getTime())) return { error: "تاريخ غير صالح" };

    try {
      const id = await db.transaction(async (tx) => {
        let rjId = d.id;
        if (rjId) {
          await tx.update(recurringJournals).set({ name: d.name, description: d.description || null, frequency: d.frequency, nextRunDate: nextRun, updatedAt: new Date() })
            .where(and(eq(recurringJournals.id, rjId), eq(recurringJournals.organizationId, auth.orgId)));
          await tx.delete(recurringJournalLines).where(eq(recurringJournalLines.recurringJournalId, rjId));
        } else {
          const [r] = await tx.insert(recurringJournals).values({ organizationId: auth.orgId, name: d.name, description: d.description || null, frequency: d.frequency, nextRunDate: nextRun }).returning({ id: recurringJournals.id });
          rjId = r.id;
        }
        await tx.insert(recurringJournalLines).values(lines.map((l) => ({
          recurringJournalId: rjId!, accountId: l.accountId, debit: l.debit.toFixed(2), credit: l.credit.toFixed(2), description: l.description || null,
        })));
        return rjId!;
      });
      revalidatePath("/accounting/recurring-journals");
      return { ok: true, id };
    } catch (e) {
      return { error: e instanceof Error ? e.message : "تعذّر الحفظ" };
    }
  });
}

export async function toggleRecurringJournalAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("accounting.create");
  if ("error" in auth) return auth;
  return withOrgScope(auth.orgId, false, async () => {
    const [r] = await db.select({ isActive: recurringJournals.isActive }).from(recurringJournals)
      .where(and(eq(recurringJournals.id, id), eq(recurringJournals.organizationId, auth.orgId))).limit(1);
    if (!r) return { error: "القالب غير موجود" };
    await db.update(recurringJournals).set({ isActive: !r.isActive, updatedAt: new Date() })
      .where(and(eq(recurringJournals.id, id), eq(recurringJournals.organizationId, auth.orgId)));
    revalidatePath("/accounting/recurring-journals");
    return { ok: true };
  });
}

export async function deleteRecurringJournalAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("accounting.create");
  if ("error" in auth) return auth;
  return withOrgScope(auth.orgId, false, async () => {
    await db.delete(recurringJournals).where(and(eq(recurringJournals.id, id), eq(recurringJournals.organizationId, auth.orgId)));
    revalidatePath("/accounting/recurring-journals");
    return { ok: true };
  });
}

export async function bulkDeleteRecurringJournalsAction(ids: string[]): Promise<BulkResult> {
  return bulkRun(ids, deleteRecurringJournalAction);
}
