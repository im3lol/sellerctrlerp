import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { investments, investorShares, profitDistributions, withdrawals } from "@/db/schema";
import { computeOwnership } from "@/lib/erp/investors";
import { round2 } from "@/lib/erp/money";

// SECURITY: these read investor equity for a given orgId with no auth of their own —
// plain server-only helpers, NOT server actions. Never export them from a `"use server"`
// module (that would make them callable IDOR endpoints). Callers must pass their OWN
// resolved orgId (from getActiveOrg / authorizeErp), never an attacker-supplied one.

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
