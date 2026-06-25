"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireErpModule } from "@/lib/erp/org";
import { accountBudgets, accounts } from "@/db/schema";
import type { ActionState } from "@/lib/erp/action-auth";

export interface BudgetLineInput {
  accountId: string;
  amount: number;
}

export async function saveBudgetAction(input: {
  year: number;
  lines: BudgetLineInput[];
}): Promise<ActionState> {
  const { orgId } = await requireErpModule("accounting.create");
  const { year, lines } = input;

  if (year < 2000 || year > 2100) return { error: "سنة غير صالحة" };
  if (!lines.length) return { error: "لا توجد بنود" };

  // Verify all accountIds belong to this org and are leaf REVENUE/EXPENSE accounts
  const ids = lines.map((l) => l.accountId);
  const accs = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.organizationId, orgId)));
  const validIds = new Set(accs.map((a) => a.id));
  if (ids.some((id) => !validIds.has(id))) return { error: "حساب غير موجود في هذه المؤسسة" };

  await db.transaction(async (tx) => {
    for (const line of lines) {
      await tx
        .insert(accountBudgets)
        .values({
          organizationId: orgId,
          year,
          accountId: line.accountId,
          amount: String(line.amount),
        })
        .onConflictDoUpdate({
          target: [accountBudgets.organizationId, accountBudgets.year, accountBudgets.accountId],
          set: { amount: String(line.amount), updatedAt: new Date() },
        });
    }
  });

  revalidatePath(`/erp/accounting/budget/${year}`);
  revalidatePath(`/erp/accounting/budget/${year}/report`);
  return { ok: true };
}
