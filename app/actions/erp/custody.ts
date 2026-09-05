"use server";

import { z } from "zod";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { withOrgScope } from "@/lib/db-scope";
import { revalidatePath } from "@/lib/safe-revalidate";
import {
  custodyAdvances, custodySettlements, custodySettlementLines, employees, accounts,
} from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";
import { recordAudit, tryRecordAudit } from "@/lib/erp/audit";
import { nextDocumentNumber } from "@/lib/erp/sequence";
import { postEntry, reverseEntry } from "@/lib/erp/posting";
import { resolveAccountIds } from "@/lib/erp/accounting-config";
import {
  outstanding, spentTotal, settlementTotal, validateSettlement, closesAdvance,
  issueEntryLines, settlementEntryLines,
} from "@/lib/erp/custody";

/**
 * Custody advances: cash handed to an employee to spend for the company, and the
 * accounting for it afterwards. Every posting goes through the normal engine — nothing
 * here writes a balance directly.
 */

const CUSTODY_CODE = "1106";

/**
 * The employee-custody GL. Created on first use rather than added to every tenant's
 * chart: an org that never hands out cash has no reason to carry the account.
 */
async function ensureCustodyAccount(orgId: string): Promise<string> {
  const found = await resolveAccountIds(orgId, [CUSTODY_CODE]);
  if (found[CUSTODY_CODE]) return found[CUSTODY_CODE];
  const [parent] = await db.select({ id: accounts.id }).from(accounts)
    .where(and(eq(accounts.organizationId, orgId), eq(accounts.code, "11"))).limit(1);
  const [created] = await db.insert(accounts).values({
    organizationId: orgId, code: CUSTODY_CODE, nameAr: "عهد الموظفين",
    type: "ASSET", normalBalance: "DEBIT", parentId: parent?.id ?? null, isLeaf: true,
  }).returning({ id: accounts.id });
  return created.id;
}

const advanceSchema = z.object({
  employeeId: z.string().min(1, "اختر الموظف"),
  cashAccountId: z.string().min(1, "اختر حساب النقدية"),
  date: z.string().min(1, "التاريخ مطلوب"),
  amount: z.coerce.number().positive("المبلغ لازم يكون أكبر من صفر"),
  purpose: z.string().trim().max(200).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
});

/** Issue an advance: cash leaves, and the employee now owes it back or in receipts. */
export async function issueCustodyAction(input: z.input<typeof advanceSchema>): Promise<ActionState & { id?: string; number?: string }> {
  const auth = await authorizeErp("accounting.post");
  if ("error" in auth) return auth;

  const parsed = advanceSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  return withOrgScope(auth.orgId, false, async () => {
    const [emp] = await db.select({ id: employees.id, name: employees.fullName })
      .from(employees).where(and(eq(employees.id, d.employeeId), eq(employees.organizationId, auth.orgId))).limit(1);
    if (!emp) return { error: "الموظف غير موجود" };

    const [cash] = await db.select({ id: accounts.id }).from(accounts)
      .where(and(eq(accounts.id, d.cashAccountId), eq(accounts.organizationId, auth.orgId))).limit(1);
    if (!cash) return { error: "حساب النقدية غير موجود" };

    const custodyAccountId = await ensureCustodyAccount(auth.orgId);
    const date = new Date(d.date);
    const number = await nextDocumentNumber(db, auth.orgId, "CUS", date.getFullYear());

    try {
      const id = await db.transaction(async (tx) => {
        const [adv] = await tx.insert(custodyAdvances).values({
          organizationId: auth.orgId, number, employeeId: emp.id, employeeName: emp.name ?? "—",
          cashAccountId: d.cashAccountId, date, amount: String(d.amount),
          status: "OPEN", purpose: d.purpose?.trim() || null, notes: d.notes?.trim() || null,
        }).returning({ id: custodyAdvances.id });

        const entryId = await postEntry(tx, {
          orgId: auth.orgId, date, sourceType: "CUSTODY_ADVANCE", sourceId: adv.id,
          description: `عهدة ${number} — ${emp.name ?? ""}`, journalType: "GENERAL", userId: auth.userId,
          lines: issueEntryLines(custodyAccountId, d.cashAccountId, d.amount, `عهدة ${number}`),
        });
        await tx.update(custodyAdvances).set({ journalEntryId: entryId }).where(eq(custodyAdvances.id, adv.id));

        await recordAudit(tx, {
          orgId: auth.orgId, userId: auth.userId, action: "POST", entityType: "CUSTODY_ADVANCE",
          entityId: adv.id, entityNumber: number,
          summary: `صرف عهدة ${number} لـ${emp.name ?? ""} بمبلغ ${d.amount}`,
        });
        return adv.id;
      });
      revalidatePath("/accounting/custody");
      return { ok: true, id, number };
    } catch (e) {
      return { error: e instanceof Error ? e.message : "تعذّر صرف العهدة" };
    }
  });
}

const settleSchema = z.object({
  advanceId: z.string().min(1),
  date: z.string().min(1, "التاريخ مطلوب"),
  returnedAmount: z.coerce.number().min(0).default(0),
  notes: z.string().trim().max(500).optional().nullable(),
  lines: z.array(z.object({
    expenseAccountId: z.string().min(1, "اختر حساب المصروف"),
    amount: z.coerce.number().positive("المبلغ لازم يكون أكبر من صفر"),
    description: z.string().trim().max(200).optional().nullable(),
  })).max(100),
});

/** Account for what was spent, take back what is left, and close the advance if it is done. */
export async function settleCustodyAction(input: z.input<typeof settleSchema>): Promise<ActionState & { number?: string }> {
  const auth = await authorizeErp("accounting.post");
  if ("error" in auth) return auth;

  const parsed = settleSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  return withOrgScope(auth.orgId, false, async () => {
    const [adv] = await db.select().from(custodyAdvances)
      .where(and(eq(custodyAdvances.id, d.advanceId), eq(custodyAdvances.organizationId, auth.orgId))).limit(1);
    if (!adv) return { error: "العهدة غير موجودة" };
    if (adv.status !== "OPEN") return { error: "العهدة مقفولة أو ملغية" };

    const err = validateSettlement({
      lines: d.lines,
      returnedAmount: d.returnedAmount,
      advanceAmount: Number(adv.amount),
      alreadySettled: Number(adv.settledAmount),
    });
    if (err) return { error: err };

    // Expense accounts must belong to this org — the ids come from the client.
    const accIds = [...new Set(d.lines.map((l) => l.expenseAccountId))];
    if (accIds.length) {
      const found = await db.select({ id: accounts.id }).from(accounts)
        .where(and(eq(accounts.organizationId, auth.orgId), sql`${accounts.id} = ANY(${accIds})`));
      if (found.length !== accIds.length) return { error: "حساب مصروف غير معروف" };
    }

    const custodyAccountId = await ensureCustodyAccount(auth.orgId);
    const date = new Date(d.date);
    const number = await nextDocumentNumber(db, auth.orgId, "CST", date.getFullYear());
    const total = settlementTotal(d.lines, d.returnedAmount);

    try {
      await db.transaction(async (tx) => {
        // Re-read the advance under lock: two settlements racing could each pass the
        // ceiling check on the same stale settledAmount and together over-clear it.
        const [locked] = await tx.select({ status: custodyAdvances.status, amount: custodyAdvances.amount, settled: custodyAdvances.settledAmount })
          .from(custodyAdvances).where(eq(custodyAdvances.id, adv.id)).for("update").limit(1);
        if (!locked || locked.status !== "OPEN") throw new Error("تغيّرت حالة العهدة — حدّث الصفحة");
        const lockedErr = validateSettlement({
          lines: d.lines, returnedAmount: d.returnedAmount,
          advanceAmount: Number(locked.amount), alreadySettled: Number(locked.settled),
        });
        if (lockedErr) throw new Error(lockedErr);

        const [st] = await tx.insert(custodySettlements).values({
          organizationId: auth.orgId, number, advanceId: adv.id, date,
          returnedAmount: String(d.returnedAmount), spentAmount: String(spentTotal(d.lines)),
          status: "POSTED", notes: d.notes?.trim() || null,
        }).returning({ id: custodySettlements.id });

        if (d.lines.length) {
          await tx.insert(custodySettlementLines).values(d.lines.map((l) => ({
            settlementId: st.id, expenseAccountId: l.expenseAccountId,
            amount: String(l.amount), description: l.description?.trim() || null,
          })));
        }

        const entryId = await postEntry(tx, {
          orgId: auth.orgId, date, sourceType: "CUSTODY_SETTLEMENT", sourceId: st.id,
          description: `تسوية عهدة ${adv.number} — ${number}`, journalType: "GENERAL", userId: auth.userId,
          lines: settlementEntryLines(custodyAccountId, adv.cashAccountId, d.lines, d.returnedAmount, `تسوية ${number}`),
        });
        await tx.update(custodySettlements).set({ journalEntryId: entryId }).where(eq(custodySettlements.id, st.id));

        const done = closesAdvance({
          lines: d.lines, returnedAmount: d.returnedAmount,
          advanceAmount: Number(locked.amount), alreadySettled: Number(locked.settled),
        });
        await tx.update(custodyAdvances).set({
          settledAmount: sql`${custodyAdvances.settledAmount} + ${total}`,
          status: done ? "SETTLED" : "OPEN",
          updatedAt: new Date(),
        }).where(eq(custodyAdvances.id, adv.id));

        await recordAudit(tx, {
          orgId: auth.orgId, userId: auth.userId, action: "POST", entityType: "CUSTODY_SETTLEMENT",
          entityId: st.id, entityNumber: number,
          summary: `تسوية عهدة ${adv.number} بمبلغ ${total}${done ? " — أُقفلت" : ""}`,
        });
      });
      revalidatePath("/accounting/custody");
      return { ok: true, number };
    } catch (e) {
      return { error: e instanceof Error ? e.message : "تعذّر تسجيل التسوية" };
    }
  });
}

/**
 * Cancel an unsettled advance — the "wrong entry" undo. Refuses once anything has been
 * settled against it: that money is accounted for, and unwinding it belongs in a
 * settlement, not a cancellation.
 */
export async function cancelCustodyAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("accounting.reverse");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
    const [adv] = await db.select().from(custodyAdvances)
      .where(and(eq(custodyAdvances.id, id), eq(custodyAdvances.organizationId, auth.orgId))).limit(1);
    if (!adv) return { error: "العهدة غير موجودة" };
    if (adv.status === "CANCELLED") return { error: "ملغية بالفعل" };
    if (Number(adv.settledAmount) > 0) return { error: "في تسويات مسجّلة على العهدة دي — مينفعش تلغيها" };

    try {
      await db.transaction(async (tx) => {
        if (adv.journalEntryId) {
          await reverseEntry(tx, { orgId: auth.orgId, entryId: adv.journalEntryId, userId: auth.userId, reason: `إلغاء عهدة ${adv.number}` });
        }
        await tx.update(custodyAdvances).set({ status: "CANCELLED", updatedAt: new Date() }).where(eq(custodyAdvances.id, id));
      });
      await tryRecordAudit({
        orgId: auth.orgId, userId: auth.userId, action: "CANCEL", entityType: "CUSTODY_ADVANCE",
        entityId: id, entityNumber: adv.number, summary: `إلغاء عهدة ${adv.number} وعكس قيدها`,
      });
      revalidatePath("/accounting/custody");
      return { ok: true };
    } catch (e) {
      return { error: e instanceof Error ? e.message : "تعذّر الإلغاء" };
    }
  });
}

/** Advances with their outstanding balances, for the screen. */
export async function listCustodyAction(): Promise<
  ActionState & {
    rows?: { id: string; number: string; employeeName: string; date: string; amount: number; settled: number; left: number; status: string; purpose: string | null }[];
    settlements?: Record<string, { number: string; date: string; spent: number; returned: number }[]>;
  }
> {
  const auth = await authorizeErp("accounting.view");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
    const rows = await db.select().from(custodyAdvances)
      .where(eq(custodyAdvances.organizationId, auth.orgId))
      .orderBy(desc(custodyAdvances.date))
      .limit(300);

    const sts = await db.select({
      advanceId: custodySettlements.advanceId, number: custodySettlements.number,
      date: custodySettlements.date, spent: custodySettlements.spentAmount, returned: custodySettlements.returnedAmount,
    }).from(custodySettlements)
      .where(eq(custodySettlements.organizationId, auth.orgId))
      .orderBy(asc(custodySettlements.date));

    const byAdvance: Record<string, { number: string; date: string; spent: number; returned: number }[]> = {};
    for (const s of sts) {
      (byAdvance[s.advanceId] ??= []).push({
        number: s.number, date: new Date(s.date).toISOString().slice(0, 10),
        spent: Number(s.spent), returned: Number(s.returned),
      });
    }

    return {
      ok: true,
      settlements: byAdvance,
      rows: rows.map((r) => ({
        id: r.id, number: r.number, employeeName: r.employeeName,
        date: new Date(r.date).toISOString().slice(0, 10),
        amount: Number(r.amount), settled: Number(r.settledAmount),
        left: outstanding(Number(r.amount), Number(r.settledAmount)),
        status: r.status, purpose: r.purpose,
      })),
    };
  });
}
