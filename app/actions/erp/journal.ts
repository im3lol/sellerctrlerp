"use server";

import { withOrgScope } from "@/lib/db-scope";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "@/lib/safe-revalidate";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { journalEntries, journalEntryLines, accounts } from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";
import { postEntry, postDraft, reverseEntry } from "@/lib/erp/posting";
import { nextDocumentNumber } from "@/lib/erp/sequence";
import { tryRecordAudit } from "@/lib/erp/audit";
import { bulkOp, type BulkOpResult } from "@/lib/erp/bulk-delete";

export type SaveEntryState = ActionState & { id?: string };

const lineSchema = z.object({
  accountId: z.string().min(1),
  debit: z.coerce.number().min(0).default(0),
  credit: z.coerce.number().min(0).default(0),
  description: z.string().optional(),
  costCenterId: z.string().optional(),
});

const schema = z.object({
  date: z.string().min(1, "التاريخ مطلوب"),
  description: z.string().min(1, "البيان مطلوب"),
  reference: z.string().optional(),
  mode: z.enum(["draft", "post"]).default("draft"),
  lines: z.array(lineSchema).min(2, "القيد يحتاج بندين على الأقل"),
});

const cents = (n: number) => Math.round(Number(n || 0) * 100);

/** Next DRAFT entry number DR-YYYY-NNNN for the org (atomic). */
async function nextDraftNumber(orgId: string, year: number): Promise<string> {
  return nextDocumentNumber(db, orgId, "DR", year);
}

/** Create a manual journal entry — saved as DRAFT or posted immediately. */
export async function createManualEntryAction(input: unknown): Promise<SaveEntryState> {
  const auth = await authorizeErp("accounting.create");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
    const parsed = schema.safeParse(input);
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const { date, description, reference, mode, lines } = parsed.data;

    if (mode === "post") {
      const auth2 = await authorizeErp("accounting.post");
      if ("error" in auth2) return auth2;
    }

    // Keep only lines that carry an amount, then validate balance in cents.
    const active = lines.filter((l) => cents(l.debit) !== 0 || cents(l.credit) !== 0);
    if (active.length < 2) return { error: "أضف بندين على الأقل بقيمة" };
    if (active.some((l) => cents(l.debit) !== 0 && cents(l.credit) !== 0)) {
      return { error: "كل بند يكون مديناً أو دائناً وليس الاثنين معاً" };
    }
    const totalDebit = active.reduce((s, l) => s + cents(l.debit), 0);
    const totalCredit = active.reduce((s, l) => s + cents(l.credit), 0);
    if (totalDebit === 0) return { error: "لا يمكن حفظ قيد بقيمة صفر" };
    if (totalDebit !== totalCredit) {
      return { error: `القيد غير متوازن (مدين ${(totalDebit / 100).toFixed(2)} ≠ دائن ${(totalCredit / 100).toFixed(2)})` };
    }

    // Verify every account belongs to the org and is a leaf (postable).
    const accIds = [...new Set(active.map((l) => l.accountId))];
    const accs = await db
      .select({ id: accounts.id, isLeaf: accounts.isLeaf, allowManualEntries: accounts.allowManualEntries })
      .from(accounts)
      .where(and(eq(accounts.organizationId, auth.orgId), inArray(accounts.id, accIds)));
    if (accs.length !== accIds.length) return { error: "حساب غير موجود في هذه المؤسسة" };
    if (accs.some((a) => !a.isLeaf)) return { error: "لا يمكن الترحيل على حساب رئيسي — اختر حساباً فرعياً" };
    if (accs.some((a) => !a.allowManualEntries)) return { error: "أحد الحسابات لا يسمح بالقيود اليدوية" };

    const entryDate = new Date(date);

    try {
      if (mode === "post") {
        const id = await db.transaction((tx) =>
          postEntry(tx, {
            orgId: auth.orgId,
            date: entryDate,
            sourceType: "MANUAL",
            sourceId: randomUUID(),
            description,
            journalType: "GENERAL",
            userId: auth.userId,
            lines: active.map((l) => ({
              accountId: l.accountId,
              debit: l.debit,
              credit: l.credit,
              description: l.description || null,
              costCenterId: l.costCenterId || null,
            })),
          }),
        );
        await tryRecordAudit({ orgId: auth.orgId, userId: auth.userId, action: "POST", entityType: "JOURNAL_ENTRY", entityId: id, summary: `قيد يدوي مُرحّل: ${description}`, metadata: { debit: totalDebit / 100 } });
        revalidatePath("/accounting/journal");
        return { ok: true, id };
      }

      // Draft: persist without posting (period/numbering finalised on post).
      const number = await nextDraftNumber(auth.orgId, entryDate.getFullYear());
      const id = await db.transaction(async (tx) => {
        const [entry] = await tx
          .insert(journalEntries)
          .values({
            organizationId: auth.orgId,
            number,
            date: entryDate,
            reference: reference || null,
            description,
            status: "DRAFT",
            sourceType: "MANUAL",
            sourceId: randomUUID(),
            createdById: auth.userId,
          })
          .returning({ id: journalEntries.id });

        await tx.insert(journalEntryLines).values(
          active.map((l) => ({
            journalEntryId: entry.id,
            accountId: l.accountId,
            costCenterId: l.costCenterId || null,
            debit: l.debit.toFixed(2),
            credit: l.credit.toFixed(2),
            description: l.description || null,
          })),
        );
        return entry.id;
      });

      await tryRecordAudit({ orgId: auth.orgId, userId: auth.userId, action: "CREATE", entityType: "JOURNAL_ENTRY", entityId: id, entityNumber: number, summary: `قيد يدوي (مسودة): ${description}`, metadata: { debit: totalDebit / 100 } });
      revalidatePath("/accounting/journal");
      return { ok: true, id };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "تعذّر حفظ القيد";
      return { error: msg };
    }
  });
}

/** Post a DRAFT entry to the ledger. */
export async function postDraftEntryAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("accounting.post");
  if ("error" in auth) return auth;
  return withOrgScope(auth.orgId, false, async () => {
    try {
      await db.transaction((tx) => postDraft(tx, { orgId: auth.orgId, entryId: id, userId: auth.userId }));
      await tryRecordAudit({ orgId: auth.orgId, userId: auth.userId, action: "POST", entityType: "JOURNAL_ENTRY", entityId: id, summary: "ترحيل قيد يومية" });
      revalidatePath("/accounting/journal");
      revalidatePath(`/accounting/journal/${id}`);
      return { ok: true };
    } catch (e) {
      return { error: e instanceof Error ? e.message : "تعذّر الترحيل" };
    }
  });
}

// GL-only sources a journal-side reversal may touch. Document-generated entries
// (invoices, vouchers, deliveries…) also moved subledgers — customer/supplier
// balances, invoice balanceDue, stock — that a mirror entry does NOT move back;
// reversing them here desyncs GL from the subledgers. Those must go through the
// document's own cancel/return flow.
const REVERSIBLE_SOURCES = new Set(["MANUAL", "RECURRING"]);

/** Reverse a POSTED entry (creates a mirror entry; never deletes). */
export async function reverseEntryAction(id: string, reason?: string): Promise<ActionState & { reversalId?: string }> {
  const auth = await authorizeErp("accounting.reverse");
  if ("error" in auth) return auth;
  return withOrgScope(auth.orgId, false, async () => {
    const [entry] = await db.select({ sourceType: journalEntries.sourceType }).from(journalEntries)
      .where(and(eq(journalEntries.id, id), eq(journalEntries.organizationId, auth.orgId))).limit(1);
    if (!entry) return { error: "القيد غير موجود" };
    if (!REVERSIBLE_SOURCES.has(entry.sourceType ?? "MANUAL")) {
      return { error: "هذا القيد ناتج عن مستند — استخدم إلغاء/مرتجع المستند نفسه حتى لا تختل أرصدة العملاء/الموردين والمخزون" };
    }
    try {
      const reversalId = await db.transaction((tx) =>
        reverseEntry(tx, { orgId: auth.orgId, entryId: id, userId: auth.userId, reason: reason || null }),
      );
      await tryRecordAudit({ orgId: auth.orgId, userId: auth.userId, action: "REVERSE", entityType: "JOURNAL_ENTRY", entityId: id, summary: "عكس قيد يومية", metadata: { reversalId, reason: reason || null } });
      revalidatePath("/accounting/journal");
      revalidatePath(`/accounting/journal/${id}`);
      return { ok: true, reversalId };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "تعذّر عكس القيد";
      return { error: msg.includes("unique") || msg.includes("23505") ? "القيد معكوس بالفعل" : msg };
    }
  });
}

/** Delete a DRAFT entry (posted entries can only be reversed). */
export async function deleteDraftEntryAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("accounting.create");
  if ("error" in auth) return auth;
  return withOrgScope(auth.orgId, false, async () => {
    try {
      const [entry] = await db
        .select({ status: journalEntries.status })
        .from(journalEntries)
        .where(and(eq(journalEntries.id, id), eq(journalEntries.organizationId, auth.orgId)))
        .limit(1);
      if (!entry) return { error: "القيد غير موجود" };
      if (entry.status !== "DRAFT") return { error: "لا يمكن حذف قيد مُرحّل — استخدم العكس" };
      await db.delete(journalEntries).where(and(eq(journalEntries.id, id), eq(journalEntries.organizationId, auth.orgId)));
      await tryRecordAudit({ orgId: auth.orgId, userId: auth.userId, action: "DELETE", entityType: "JOURNAL_ENTRY", entityId: id, summary: "حذف قيد يومية (مسودة)" });
      revalidatePath("/accounting/journal");
      return { ok: true };
    } catch {
      return { error: "تعذّر حذف القيد" };
    }
  });
}

/** Bulk post/delete DRAFT entries; each id runs the guarded single-item action. */
export async function bulkJournalAction(op: "post" | "delete", ids: string[]): Promise<BulkOpResult> {
  return bulkOp(ids, op === "post" ? postDraftEntryAction : deleteDraftEntryAction);
}
