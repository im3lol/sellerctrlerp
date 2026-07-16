"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { accounts, investors, investments, investorShares, profitDistributions, withdrawals } from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";
import { postEntry } from "@/lib/erp/posting";
import { allocateProfit, computeOwnership } from "@/lib/erp/investors";
import { round2 } from "@/lib/erp/money";
import { tryRecordAudit } from "@/lib/erp/audit";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Investor equity accounts, created on first use (the base chart has only 3101
 * رأس المال). Same approach as ensureAmazonAccounts / ensureDisposalAccounts.
 *
 *  3102 رأس مال المستثمرين      EQUITY/CREDIT — capital they put in
 *  3103 أرباح موزّعة            EQUITY/DEBIT  — contra-equity: profit declared out
 *  2104 أرباح مستحقة للمستثمرين LIABILITY     — declared but not yet paid
 *
 * 3103 is deliberately a contra-equity account rather than an expense: distributing
 * profit is not a cost of doing business, it reduces equity. naturalAmount() signs
 * by `type`, so a DEBIT-normal EQUITY account correctly *reduces* total equity on
 * the balance sheet.
 */
async function ensureInvestorAccounts(orgId: string, tx: Tx) {
  const rows = await tx.select({ id: accounts.id, code: accounts.code }).from(accounts).where(eq(accounts.organizationId, orgId));
  const byCode = new Map(rows.map((a) => [a.code, a.id]));

  const need = async (code: string, nameAr: string, type: string, normalBalance: string, parent: string) => {
    const found = byCode.get(code);
    if (found) return found;
    const [r] = await tx.insert(accounts).values({
      organizationId: orgId, code, nameAr, type, normalBalance,
      parentId: byCode.get(parent) ?? null, isLeaf: true,
    }).returning({ id: accounts.id });
    return r.id;
  };

  return {
    capital: await need("3102", "رأس مال المستثمرين", "EQUITY", "CREDIT", "3"),
    distributed: await need("3103", "أرباح موزّعة على المستثمرين", "EQUITY", "DEBIT", "3"),
    payable: await need("2104", "أرباح مستحقة للمستثمرين", "LIABILITY", "CREDIT", "21"),
  };
}

/** A cash/bank leaf the money actually moved through. */
async function assertCashAccount(orgId: string, accountId: string) {
  const [a] = await db.select({ id: accounts.id, isLeaf: accounts.isLeaf, type: accounts.type, code: accounts.code })
    .from(accounts).where(and(eq(accounts.id, accountId), eq(accounts.organizationId, orgId))).limit(1);
  if (!a) return "الحساب غير موجود";
  if (!a.isLeaf) return "اختر حسابًا فرعيًا (ليس حساب تجميع)";
  if (a.type !== "ASSET" || !/^(1101|1102)/.test(a.code)) return "اختر حساب نقدية أو بنك";
  return null;
}

/* ══════════════════ Capital contribution ══════════════════ */

const investmentSchema = z.object({
  investorId: z.string().min(1, "اختر المستثمر"),
  date: z.string().min(1, "التاريخ مطلوب"),
  amount: z.number().positive("المبلغ يجب أن يكون أكبر من صفر"),
  accountId: z.string().min(1, "اختر حساب النقدية/البنك الذي استلم المبلغ"),
  notes: z.string().optional(),
});

/**
 * Record capital coming in: Dr cash/bank / Cr 3102 رأس مال المستثمرين.
 *
 * Posts immediately — there is no draft. The money has already arrived; a capital
 * contribution sitting unposted is just equity missing from the balance sheet.
 */
export async function createInvestmentAction(input: unknown): Promise<ActionState & { id?: string }> {
  const auth = await authorizeErp("accounting.post");
  if ("error" in auth) return auth;
  const parsed = investmentSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  const [inv] = await db.select({ id: investors.id, name: investors.fullName })
    .from(investors).where(and(eq(investors.id, d.investorId), eq(investors.organizationId, auth.orgId))).limit(1);
  if (!inv) return { error: "المستثمر غير موجود" };

  const bad = await assertCashAccount(auth.orgId, d.accountId);
  if (bad) return { error: bad };

  const date = new Date(d.date);
  if (Number.isNaN(date.getTime())) return { error: "التاريخ غير صالح" };
  const amount = round2(d.amount);

  try {
    const id = await db.transaction(async (tx) => {
      const A = await ensureInvestorAccounts(auth.orgId, tx);
      const [row] = await tx.insert(investments).values({
        organizationId: auth.orgId, investorId: d.investorId, date, amount: String(amount),
        type: "cash", accountId: d.accountId, notes: d.notes?.trim() || null,
      }).returning({ id: investments.id });

      await postEntry(tx, {
        orgId: auth.orgId, userId: auth.userId,
        sourceType: "INVESTMENT", sourceId: row.id, date,
        description: `مساهمة رأس مال — ${inv.name}`, journalType: "GENERAL",
        lines: [
          { accountId: d.accountId, debit: amount, credit: 0, description: `مساهمة ${inv.name}` },
          { accountId: A.capital, debit: 0, credit: amount, description: `رأس مال ${inv.name}` },
        ],
      });
      return row.id;
    });

    await tryRecordAudit({ orgId: auth.orgId, userId: auth.userId, action: "CREATE", entityType: "INVESTMENT", entityId: id, summary: `مساهمة رأس مال ${amount} — ${inv.name}` });
    revalidatePath("/erp/investors");
    revalidatePath("/erp/investors/investments");
    revalidatePath("/erp/accounting/journal");
    return { ok: true, id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "تعذّر تسجيل المساهمة" };
  }
}

/* ══════════════════ Withdrawal ══════════════════ */

const withdrawalSchema = z.object({
  investorId: z.string().min(1, "اختر المستثمر"),
  date: z.string().min(1, "التاريخ مطلوب"),
  amount: z.number().positive("المبلغ يجب أن يكون أكبر من صفر"),
  type: z.enum(["capital", "profit"]),
  accountId: z.string().min(1, "اختر حساب النقدية/البنك الذي صُرف منه"),
  notes: z.string().optional(),
});

/**
 * Money going back out to an investor.
 *
 *   capital → Dr 3102 رأس مال المستثمرين / Cr cash — reduces their stake, and so
 *             their ownership % (computeOwnership nets withdrawals against
 *             contributions).
 *   profit  → Dr 2104 أرباح مستحقة        / Cr cash — settles a share already
 *             declared by a distribution. It does NOT touch equity again; the
 *             equity hit happened when the distribution was confirmed.
 *
 * A profit withdrawal is refused beyond what has actually been declared for that
 * investor — otherwise 2104 goes negative and the company is shown as owing
 * negative profit.
 */
export async function createWithdrawalAction(input: unknown): Promise<ActionState & { id?: string }> {
  const auth = await authorizeErp("accounting.post");
  if ("error" in auth) return auth;
  const parsed = withdrawalSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  const [inv] = await db.select({ id: investors.id, name: investors.fullName })
    .from(investors).where(and(eq(investors.id, d.investorId), eq(investors.organizationId, auth.orgId))).limit(1);
  if (!inv) return { error: "المستثمر غير موجود" };

  const bad = await assertCashAccount(auth.orgId, d.accountId);
  if (bad) return { error: bad };

  const date = new Date(d.date);
  if (Number.isNaN(date.getTime())) return { error: "التاريخ غير صالح" };
  const amount = round2(d.amount);

  if (d.type === "capital") {
    const net = await investorNetCapital(auth.orgId, d.investorId);
    if (amount > net + 1e-9) return { error: `المبلغ أكبر من رأس مال المستثمر المتبقّي (${net})` };
  } else {
    const due = await investorProfitDue(auth.orgId, d.investorId);
    if (amount > due + 1e-9) return { error: `المبلغ أكبر من الأرباح المستحقة للمستثمر (${due})` };
  }

  try {
    const id = await db.transaction(async (tx) => {
      const A = await ensureInvestorAccounts(auth.orgId, tx);
      const [row] = await tx.insert(withdrawals).values({
        organizationId: auth.orgId, investorId: d.investorId, date, amount: String(amount),
        type: d.type, accountId: d.accountId, notes: d.notes?.trim() || null,
      }).returning({ id: withdrawals.id });

      const debit = d.type === "capital" ? A.capital : A.payable;
      await postEntry(tx, {
        orgId: auth.orgId, userId: auth.userId,
        sourceType: "INVESTOR_WITHDRAWAL", sourceId: row.id, date,
        description: `${d.type === "capital" ? "سحب رأس مال" : "صرف أرباح"} — ${inv.name}`,
        journalType: "GENERAL",
        lines: [
          { accountId: debit, debit: amount, credit: 0, description: inv.name },
          { accountId: d.accountId, debit: 0, credit: amount, description: `صرف إلى ${inv.name}` },
        ],
      });
      return row.id;
    });

    await tryRecordAudit({ orgId: auth.orgId, userId: auth.userId, action: "CREATE", entityType: "INVESTOR_WITHDRAWAL", entityId: id, summary: `${d.type === "capital" ? "سحب رأس مال" : "صرف أرباح"} ${amount} — ${inv.name}` });
    revalidatePath("/erp/investors");
    revalidatePath("/erp/investors/withdrawals");
    revalidatePath("/erp/accounting/journal");
    return { ok: true, id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "تعذّر تسجيل السحب" };
  }
}

/* ══════════════════ Profit distribution ══════════════════ */

const distributionSchema = z.object({
  periodName: z.string().min(1, "اسم الفترة مطلوب"),
  periodStart: z.string().min(1, "بداية الفترة مطلوبة"),
  periodEnd: z.string().min(1, "نهاية الفترة مطلوبة"),
  distributionDate: z.string().min(1, "تاريخ التوزيع مطلوب"),
  totalProfit: z.number(),
});

/**
 * Draft a distribution: work out each investor's ownership from their net capital
 * and allocate the profit to the cent. Nothing posts until it is confirmed, so the
 * shares can be reviewed (and the percentages are stored, not recomputed later —
 * ownership changes when capital moves, and last year's distribution must not
 * silently re-split when someone invests today).
 */
export async function createDistributionAction(input: unknown): Promise<ActionState & { id?: string }> {
  const auth = await authorizeErp("accounting.create");
  if ("error" in auth) return auth;
  const parsed = distributionSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  const start = new Date(d.periodStart), end = new Date(d.periodEnd), dist = new Date(d.distributionDate);
  if ([start, end, dist].some((x) => Number.isNaN(x.getTime()))) return { error: "تاريخ غير صالح" };
  if (end < start) return { error: "نهاية الفترة قبل بدايتها" };
  const total = round2(d.totalProfit);
  if (total === 0) return { error: "لا يوجد ربح للتوزيع" };

  const owners = await orgOwnership(auth.orgId);
  if (owners.length === 0) return { error: "لا يوجد رأس مال مستثمَر — سجّل مساهمات أولاً" };
  const shares = allocateProfit(total, owners);

  try {
    const id = await db.transaction(async (tx) => {
      const [row] = await tx.insert(profitDistributions).values({
        organizationId: auth.orgId, periodName: d.periodName.trim(),
        periodStart: start, periodEnd: end, distributionDate: dist,
        totalProfit: String(total), status: "DRAFT",
      }).returning({ id: profitDistributions.id });

      await tx.insert(investorShares).values(shares.map((s) => ({
        distributionId: row.id, investorId: s.investorId,
        ownershipPercent: String(s.percent), profitShare: String(s.share), status: "PENDING",
      })));
      return row.id;
    });

    revalidatePath("/erp/investors/distributions");
    return { ok: true, id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "تعذّر إنشاء التوزيع" };
  }
}

/**
 * Confirm a distribution: Dr 3103 أرباح موزّعة / Cr 2104 أرباح مستحقة, for the sum
 * of the stored shares — not the header's totalProfit. They are equal by
 * construction (allocateProfit guarantees it), and using the shares means the entry
 * balances against exactly what each investor is owed.
 */
export async function confirmDistributionAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("accounting.post");
  if ("error" in auth) return auth;

  const [dist] = await db.select().from(profitDistributions)
    .where(and(eq(profitDistributions.id, id), eq(profitDistributions.organizationId, auth.orgId))).limit(1);
  if (!dist) return { error: "التوزيع غير موجود" };
  if (dist.status !== "DRAFT") return { error: "التوزيع مُرحّل بالفعل" };

  const rows = await db.select({ investorId: investorShares.investorId, share: investorShares.profitShare })
    .from(investorShares).where(eq(investorShares.distributionId, id));
  if (rows.length === 0) return { error: "لا توجد حصص في هذا التوزيع" };

  const total = round2(rows.reduce((s, r) => s + Number(r.share), 0));
  if (total === 0) return { error: "إجمالي الحصص صفر" };

  try {
    await db.transaction(async (tx) => {
      // Claim first, conditionally: the status check above is outside the
      // transaction, and this entry is the only thing standing between a
      // double-click and declaring the same profit twice.
      const claimed = await tx.update(profitDistributions).set({ status: "POSTED" })
        .where(and(eq(profitDistributions.id, id), eq(profitDistributions.status, "DRAFT")))
        .returning({ id: profitDistributions.id });
      if (claimed.length === 0) throw new Error("ALREADY_POSTED");

      const A = await ensureInvestorAccounts(auth.orgId, tx);
      await postEntry(tx, {
        orgId: auth.orgId, userId: auth.userId,
        sourceType: "PROFIT_DISTRIBUTION", sourceId: id, date: new Date(dist.distributionDate),
        description: `توزيع أرباح — ${dist.periodName}`, journalType: "GENERAL",
        lines: [
          { accountId: A.distributed, debit: total, credit: 0, description: `أرباح موزّعة ${dist.periodName}` },
          { accountId: A.payable, debit: 0, credit: total, description: `مستحق للمستثمرين ${dist.periodName}` },
        ],
      });
    });

    await tryRecordAudit({ orgId: auth.orgId, userId: auth.userId, action: "POST", entityType: "PROFIT_DISTRIBUTION", entityId: id, summary: `ترحيل توزيع أرباح ${dist.periodName} — ${total}` });
    revalidatePath("/erp/investors");
    revalidatePath("/erp/investors/distributions");
    revalidatePath("/erp/accounting/journal");
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "ALREADY_POSTED") return { error: "التوزيع مُرحّل بالفعل" };
    return { error: msg || "تعذّر ترحيل التوزيع" };
  }
}

/** Delete a DRAFT distribution (its shares cascade). Posted ones are immutable. */
export async function deleteDistributionAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("accounting.create");
  if ("error" in auth) return auth;
  const [d] = await db.select({ status: profitDistributions.status }).from(profitDistributions)
    .where(and(eq(profitDistributions.id, id), eq(profitDistributions.organizationId, auth.orgId))).limit(1);
  if (!d) return { error: "التوزيع غير موجود" };
  if (d.status !== "DRAFT") return { error: "لا يمكن حذف توزيع مُرحّل — اعكسه بدلاً من ذلك" };
  await db.delete(profitDistributions).where(and(eq(profitDistributions.id, id), eq(profitDistributions.organizationId, auth.orgId)));
  revalidatePath("/erp/investors/distributions");
  return { ok: true };
}

/* ══════════════════ Queries ══════════════════ */

/** Net capital (contributions − capital withdrawals) for one investor. */
export async function investorNetCapital(orgId: string, investorId: string): Promise<number> {
  const [inV] = await db.select({ v: sql<string>`coalesce(sum(${investments.amount}), 0)` })
    .from(investments).where(and(eq(investments.organizationId, orgId), eq(investments.investorId, investorId)));
  const [outV] = await db.select({ v: sql<string>`coalesce(sum(${withdrawals.amount}), 0)` })
    .from(withdrawals).where(and(eq(withdrawals.organizationId, orgId), eq(withdrawals.investorId, investorId), eq(withdrawals.type, "capital")));
  return round2(Number(inV?.v ?? 0) - Number(outV?.v ?? 0));
}

/** Declared-but-unpaid profit for one investor: POSTED shares − profit withdrawals. */
export async function investorProfitDue(orgId: string, investorId: string): Promise<number> {
  const [declared] = await db.select({ v: sql<string>`coalesce(sum(${investorShares.profitShare}), 0)` })
    .from(investorShares)
    .innerJoin(profitDistributions, eq(profitDistributions.id, investorShares.distributionId))
    .where(and(eq(profitDistributions.organizationId, orgId), eq(profitDistributions.status, "POSTED"), eq(investorShares.investorId, investorId)));
  const [paid] = await db.select({ v: sql<string>`coalesce(sum(${withdrawals.amount}), 0)` })
    .from(withdrawals).where(and(eq(withdrawals.organizationId, orgId), eq(withdrawals.investorId, investorId), eq(withdrawals.type, "profit")));
  return round2(Number(declared?.v ?? 0) - Number(paid?.v ?? 0));
}

/** Ownership split across the org, from every investor's net capital. */
export async function orgOwnership(orgId: string) {
  const inRows = await db.select({ investorId: investments.investorId, amount: investments.amount })
    .from(investments).where(eq(investments.organizationId, orgId));
  const outRows = await db.select({ investorId: withdrawals.investorId, amount: withdrawals.amount })
    .from(withdrawals).where(and(eq(withdrawals.organizationId, orgId), eq(withdrawals.type, "capital")));
  return computeOwnership([
    ...inRows.map((r) => ({ investorId: r.investorId, amount: Number(r.amount) })),
    ...outRows.map((r) => ({ investorId: r.investorId, amount: -Number(r.amount) })),
  ]);
}
