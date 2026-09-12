"use server";

import { withOrgScope } from "@/lib/db-scope";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import * as XLSX from "xlsx";
import { revalidatePath } from "@/lib/safe-revalidate";
import { db } from "@/lib/db";
import { requireErpModule } from "@/lib/erp/org";
import { bankAccounts, bankStatementLines, salesPlatforms } from "@/db/schema";
import { parseDate } from "@/lib/erp/dates";
import { parseCsv } from "@/lib/erp/csv";
import { parseBankRows, lineKey, type ParsedLine } from "@/lib/erp/bank-import";
import type { ActionState } from "@/lib/erp/action-auth";
import { bulkRun, type BulkResult } from "@/lib/erp/bulk-delete";

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

  return withOrgScope(orgId, false, async () => {
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
      revalidatePath("/accounting/banks");
      return { ok: true, id: input.id };
    }

    const [row] = await db.insert(bankAccounts).values(values).returning({ id: bankAccounts.id });
    revalidatePath("/accounting/banks");
    return { ok: true, id: row.id };
  });
}

/* ── Toggle active ─────────────────────────────────────────── */
export async function toggleBankAccountActiveAction(id: string): Promise<ActionState> {
  const { orgId } = await requireErpModule("accounting.create");
  return withOrgScope(orgId, false, async () => {
    const [ba] = await db
      .select({ isActive: bankAccounts.isActive })
      .from(bankAccounts)
      .where(and(eq(bankAccounts.id, id), eq(bankAccounts.organizationId, orgId)));
    if (!ba) return { error:"الحساب البنكي غير موجود" };

    await db
      .update(bankAccounts)
      .set({ isActive: !ba.isActive, updatedAt: new Date() })
      .where(eq(bankAccounts.id, id));
    revalidatePath("/accounting/banks");
    return { ok: true };
  });
}

/* ── Delete bank account (guarded by linked data) ──────────── */
export async function deleteBankAccountAction(id: string): Promise<ActionState> {
  const { orgId } = await requireErpModule("accounting.create");
  return withOrgScope(orgId, false, async () => {
    const [ba] = await db
      .select({ id: bankAccounts.id })
      .from(bankAccounts)
      .where(and(eq(bankAccounts.id, id), eq(bankAccounts.organizationId, orgId)));
    if (!ba) return { error: "الحساب البنكي غير موجود" };

    // Refuse deletion while the account is still referenced — the user must unlink first.
    const [{ n: stmtCount }] = await db
      .select({ n: sql<number>`count(*)` })
      .from(bankStatementLines)
      .where(and(eq(bankStatementLines.bankAccountId, id), eq(bankStatementLines.organizationId, orgId)));
    const platformRows = await db
      .select({ name: salesPlatforms.name })
      .from(salesPlatforms)
      .where(and(eq(salesPlatforms.bankAccountId, id), eq(salesPlatforms.organizationId, orgId)));

    const linked: string[] = [];
    if (Number(stmtCount) > 0) linked.push(`${Number(stmtCount)} حركة كشف بنكي`);
    if (platformRows.length) linked.push(`منصات مرتبطة: ${platformRows.map((p) => p.name).join("، ")}`);
    if (linked.length) {
      return { error: `لا يمكن الحذف — الحساب مرتبط بـ: ${linked.join(" · ")}. أزِل الارتباط أولًا ثم أعد المحاولة.` };
    }

    await db.delete(bankAccounts).where(and(eq(bankAccounts.id, id), eq(bankAccounts.organizationId, orgId)));
    revalidatePath("/accounting/banks");
    return { ok: true };
  });
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

  return withOrgScope(orgId, false, async () => {
    const [ba] = await db
      .select({ id: bankAccounts.id })
      .from(bankAccounts)
      .where(and(eq(bankAccounts.id, input.bankAccountId), eq(bankAccounts.organizationId, orgId)));
    if (!ba) return { error:"الحساب البنكي غير موجود" };

    const debit = input.debit ?? 0;
    const credit = input.credit ?? 0;
    if (debit === 0 && credit === 0) return { error:"يجب إدخال مبلغ واحد على الأقل" };
    const date = parseDate(input.date);
    if (!date) return { error: "التاريخ غير صالح" };

    await db.insert(bankStatementLines).values({
      organizationId: orgId,
      bankAccountId: input.bankAccountId,
      date,
      description: input.description?.trim() || null,
      reference: input.reference?.trim() || null,
      debit: String(debit),
      credit: String(credit),
    });

    revalidatePath(`/accounting/banks/${input.bankAccountId}`);
    return { ok: true };
  });
}

/* ── Import a bank statement file (Excel / CSV) ────────────── */
export type ImportPreview = ActionState & {
  columns?: string;
  sample?: { date: string; description: string; moneyIn: number; moneyOut: number }[];
  total?: number; duplicates?: number; skipped?: number; added?: number;
};

const MAX_IMPORT_LINES = 5000;

/**
 * Read the bank's own statement file. `commit=false` only reports what would be added and
 * how the columns were read, so nothing lands before the user has seen it; `commit=true`
 * saves it. Lines already on the account are skipped BY COUNT: re-uploading a file adds
 * nothing, while two genuinely identical movements in one file both stay.
 */
export async function importStatementAction(bankAccountId: string, form: FormData, commit: boolean): Promise<ImportPreview> {
  const { orgId } = await requireErpModule("accounting.create");
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "اختار ملف كشف الحساب" };
  if (file.size > 8 * 1024 * 1024) return { error: "الملف أكبر من ٨ ميجا" };

  let rows: unknown[][];
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    if (/\.csv$/i.test(file.name)) {
      const text = buf.toString("utf8");
      rows = parseCsv(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text); // drop a UTF-8 BOM
    } else {
      const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
      rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: "" });
    }
  } catch {
    return { error: "تعذّر قراءة الملف — ارفع Excel أو CSV" };
  }

  const parsed = parseBankRows(rows);
  if (!parsed.mapping) return { error: "مالقيتش عمود التاريخ والمبالغ — لازم يكون في الملف صف عناوين زي «التاريخ» و«مدين/دائن» أو «المبلغ»" };
  if (parsed.lines.length === 0) return { error: "مفيش حركات في الملف" };
  if (parsed.lines.length > MAX_IMPORT_LINES) return { error: `الملف فيه ${parsed.lines.length} حركة — قسّمه لملفات أقل من ${MAX_IMPORT_LINES}` };

  // Say how each column was read — the direction (وارد/صادر) is the one thing that must be right.
  const m = parsed.mapping;
  const col = (i: number) => `«${parsed.header[i]}»`;
  const columns = [
    `التاريخ ← ${col(m.date)}`,
    ...(m.moneyIn >= 0 || m.moneyOut >= 0
      ? [m.moneyIn >= 0 ? `الوارد ← ${col(m.moneyIn)}` : "", m.moneyOut >= 0 ? `الصادر ← ${col(m.moneyOut)}` : ""]
      : [`المبلغ ← ${col(m.amount)} (الموجب وارد والسالب صادر)`]),
    m.description >= 0 ? `البيان ← ${col(m.description)}` : "",
  ].filter(Boolean).join(" · ");

  return withOrgScope(orgId, false, async () => {
    const [ba] = await db.select({ id: bankAccounts.id }).from(bankAccounts)
      .where(and(eq(bankAccounts.id, bankAccountId), eq(bankAccounts.organizationId, orgId)));
    if (!ba) return { error: "الحساب البنكي غير موجود" };

    const times = parsed.lines.map((l) => l.date.getTime());
    const existing = await db.select({
      date: bankStatementLines.date, description: bankStatementLines.description, reference: bankStatementLines.reference,
      debit: bankStatementLines.debit, credit: bankStatementLines.credit,
    }).from(bankStatementLines)
      .where(and(eq(bankStatementLines.bankAccountId, bankAccountId), eq(bankStatementLines.organizationId, orgId),
        gte(bankStatementLines.date, new Date(Math.min(...times))), lte(bankStatementLines.date, new Date(Math.max(...times)))));
    const have = new Map<string, number>();
    for (const e of existing) {
      const k = lineKey({ date: e.date, description: e.description ?? "", reference: e.reference ?? "", moneyIn: Number(e.debit), moneyOut: Number(e.credit) });
      have.set(k, (have.get(k) ?? 0) + 1);
    }
    const fresh: ParsedLine[] = [];
    let duplicates = 0;
    for (const l of parsed.lines) {
      const k = lineKey(l);
      const left = have.get(k) ?? 0;
      if (left > 0) { have.set(k, left - 1); duplicates++; } else fresh.push(l);
    }

    if (!commit) {
      return {
        ok: true, columns, total: fresh.length, duplicates, skipped: parsed.skipped,
        sample: fresh.slice(0, 8).map((l) => ({ date: l.date.toISOString().slice(0, 10), description: l.description, moneyIn: l.moneyIn, moneyOut: l.moneyOut })),
      };
    }
    // bank_statement_lines.debit = money IN to the bank (see the schema) — not the file's «مدين».
    for (let i = 0; i < fresh.length; i += 1000) {
      await db.insert(bankStatementLines).values(fresh.slice(i, i + 1000).map((l) => ({
        organizationId: orgId, bankAccountId, date: l.date,
        description: l.description || null, reference: l.reference || null,
        debit: String(l.moneyIn), credit: String(l.moneyOut),
      })));
    }
    revalidatePath(`/accounting/banks/${bankAccountId}`);
    return { ok: true, added: fresh.length, duplicates, skipped: parsed.skipped };
  });
}

/* ── Toggle reconciled ─────────────────────────────────────── */
export async function toggleStatementLineReconciledAction(lineId: string): Promise<ActionState> {
  const { orgId } = await requireErpModule("accounting.create");
  return withOrgScope(orgId, false, async () => {
    const [line] = await db
      .select({ isReconciled: bankStatementLines.isReconciled, bankAccountId: bankStatementLines.bankAccountId })
      .from(bankStatementLines)
      .where(and(eq(bankStatementLines.id, lineId), eq(bankStatementLines.organizationId, orgId)));
    if (!line) return { error:"السطر غير موجود" };

    await db
      .update(bankStatementLines)
      .set({ isReconciled: !line.isReconciled })
      .where(eq(bankStatementLines.id, lineId));

    revalidatePath(`/accounting/banks/${line.bankAccountId}`);
    return { ok: true };
  });
}

/* ── Delete statement line ─────────────────────────────────── */
export async function deleteStatementLineAction(lineId: string): Promise<ActionState> {
  const { orgId } = await requireErpModule("accounting.create");
  return withOrgScope(orgId, false, async () => {
    const [line] = await db
      .select({ bankAccountId: bankStatementLines.bankAccountId })
      .from(bankStatementLines)
      .where(and(eq(bankStatementLines.id, lineId), eq(bankStatementLines.organizationId, orgId)));
    if (!line) return { error:"السطر غير موجود" };

    await db.delete(bankStatementLines).where(eq(bankStatementLines.id, lineId));
    revalidatePath(`/accounting/banks/${line.bankAccountId}`);
    return { ok: true };
  });
}

/** Bulk-delete bank accounts; each runs the guarded single-item delete (linked ones blocked). */
export async function bulkDeleteBanksAction(ids: string[]): Promise<BulkResult> {
  return bulkRun(ids, deleteBankAccountAction);
}
