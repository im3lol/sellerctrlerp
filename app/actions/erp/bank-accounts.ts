"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireErpModule } from "@/lib/erp/org";
import { bankAccounts, bankStatementLines } from "@/db/schema";
import type { ActionState } from "@/lib/erp/action-auth";

/* ── Create / Update bank account ─────────────────────────── */
export async function upsertBankAccountAction(input: {
  id?: string;
  nameAr: string;
  bankName?: string;
  accountNumber?: string;
  iban?: string;
  glAccountId?: string;
  notes?: string;
}): Promise<ActionState & { id?: string }> {
  const { orgId } = await requireErpModule("accounting.create");

  const values = {
    organizationId: orgId,
    nameAr: input.nameAr.trim(),
    bankName: input.bankName?.trim() || null,
    accountNumber: input.accountNumber?.trim() || null,
    iban: input.iban?.trim() || null,
    glAccountId: input.glAccountId || null,
    notes: input.notes?.trim() || null,
    updatedAt: new Date(),
  };

  if (input.id) {
    await db
      .update(bankAccounts)
      .set(values)
      .where(and(eq(bankAccounts.id, input.id), eq(bankAccounts.organizationId, orgId)));
    revalidatePath("/erp/accounting/banks");
    return { ok: true, id: input.id };
  }

  const [row] = await db.insert(bankAccounts).values(values).returning({ id: bankAccounts.id });
  revalidatePath("/erp/accounting/banks");
  return { ok: true, id: row.id };
}

/* ── Toggle active ─────────────────────────────────────────── */
export async function toggleBankAccountActiveAction(id: string): Promise<ActionState> {
  const { orgId } = await requireErpModule("accounting.create");
  const [ba] = await db
    .select({ isActive: bankAccounts.isActive })
    .from(bankAccounts)
    .where(and(eq(bankAccounts.id, id), eq(bankAccounts.organizationId, orgId)));
  if (!ba) return { error:"الحساب البنكي غير موجود" };

  await db
    .update(bankAccounts)
    .set({ isActive: !ba.isActive, updatedAt: new Date() })
    .where(eq(bankAccounts.id, id));
  revalidatePath("/erp/accounting/banks");
  return { ok: true };
}

/* ── Add statement line ────────────────────────────────────── */
export async function addStatementLineAction(input: {
  bankAccountId: string;
  date: string;
  description?: string;
  reference?: string;
  debit?: number;
  credit?: number;
}): Promise<ActionState> {
  const { orgId } = await requireErpModule("accounting.create");

  const [ba] = await db
    .select({ id: bankAccounts.id })
    .from(bankAccounts)
    .where(and(eq(bankAccounts.id, input.bankAccountId), eq(bankAccounts.organizationId, orgId)));
  if (!ba) return { error:"الحساب البنكي غير موجود" };

  const debit = input.debit ?? 0;
  const credit = input.credit ?? 0;
  if (debit === 0 && credit === 0) return { error:"يجب إدخال مبلغ واحد على الأقل" };

  await db.insert(bankStatementLines).values({
    organizationId: orgId,
    bankAccountId: input.bankAccountId,
    date: new Date(input.date),
    description: input.description?.trim() || null,
    reference: input.reference?.trim() || null,
    debit: String(debit),
    credit: String(credit),
  });

  revalidatePath(`/erp/accounting/banks/${input.bankAccountId}`);
  return { ok: true };
}

/* ── Toggle reconciled ─────────────────────────────────────── */
export async function toggleStatementLineReconciledAction(lineId: string): Promise<ActionState> {
  const { orgId } = await requireErpModule("accounting.create");
  const [line] = await db
    .select({ isReconciled: bankStatementLines.isReconciled, bankAccountId: bankStatementLines.bankAccountId })
    .from(bankStatementLines)
    .where(and(eq(bankStatementLines.id, lineId), eq(bankStatementLines.organizationId, orgId)));
  if (!line) return { error:"السطر غير موجود" };

  await db
    .update(bankStatementLines)
    .set({ isReconciled: !line.isReconciled })
    .where(eq(bankStatementLines.id, lineId));

  revalidatePath(`/erp/accounting/banks/${line.bankAccountId}`);
  return { ok: true };
}

/* ── Delete statement line ─────────────────────────────────── */
export async function deleteStatementLineAction(lineId: string): Promise<ActionState> {
  const { orgId } = await requireErpModule("accounting.create");
  const [line] = await db
    .select({ bankAccountId: bankStatementLines.bankAccountId })
    .from(bankStatementLines)
    .where(and(eq(bankStatementLines.id, lineId), eq(bankStatementLines.organizationId, orgId)));
  if (!line) return { error:"السطر غير موجود" };

  await db.delete(bankStatementLines).where(eq(bankStatementLines.id, lineId));
  revalidatePath(`/erp/accounting/banks/${line.bankAccountId}`);
  return { ok: true };
}
