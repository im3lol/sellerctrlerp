import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { customers, suppliers } from "@/db/schema";
import { accountBalances } from "@/lib/erp/financials";

export type ControlDivergence = { control: string; label: string; gl: number; subledger: number; diff: number };

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Reconcile each control account's GL balance against its subledger total:
 *   AR control 1103  vs  Σ customers.balance
 *   AP control 2101  vs  Σ suppliers.balance
 * Document flows update both in the same transaction, so they stay equal — the one thing
 * that breaks the tie is a MANUAL journal entry to 1103/2101 (which moves the balance-
 * sheet control account without touching the subledger the aging report is built from).
 * Returns only the controls that diverge by more than `tol` (default 1.00, to absorb
 * rounding). GL balance is signed debit−credit; AP is a credit-normal liability so its
 * "owed" magnitude is credit−debit = −(debit−credit).
 */
export async function getControlDivergences(orgId: string, tol = 1): Promise<ControlDivergence[]> {
  const bals = await accountBalances({ orgId });
  const glDr = (code: string) => bals.find((b) => b.code === code)?.balance ?? 0; // debit − credit
  const [arSub] = await db.select({ v: sql<string>`coalesce(sum(${customers.balance}),0)` }).from(customers).where(eq(customers.organizationId, orgId));
  const [apSub] = await db.select({ v: sql<string>`coalesce(sum(${suppliers.balance}),0)` }).from(suppliers).where(eq(suppliers.organizationId, orgId));

  const out: ControlDivergence[] = [];
  const arGl = r2(glDr("1103")), arS = r2(Number(arSub?.v ?? 0));
  if (Math.abs(arGl - arS) > tol) out.push({ control: "1103", label: "ذمم العملاء", gl: arGl, subledger: arS, diff: r2(arGl - arS) });
  const apGl = r2(-glDr("2101")), apS = r2(Number(apSub?.v ?? 0));
  if (Math.abs(apGl - apS) > tol) out.push({ control: "2101", label: "ذمم الموردين", gl: apGl, subledger: apS, diff: r2(apGl - apS) });
  return out;
}
