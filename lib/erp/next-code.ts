import { and, eq, like, sql } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { db } from "@/lib/db";

/**
 * Next free `PREFIX-000n` code(s) for an org, resolved by one indexed lookup.
 *
 * The three call sites this replaces each pulled EVERY existing code for the org into JS
 * and scanned for the max — `generateItemCodes` was reading 4,709 codes to work out one
 * number. Measured on that table (EXPLAIN ANALYZE, under the real RLS scope):
 *
 *   max(code) + LIKE           Index Only Scan Backward, stops at row 1     0.4 ms
 *   max(regex-extracted int)   Seq Scan, regex per row                    154   ms
 *   SELECT every code (old)    Seq Scan, 4,709 rows                         2.2 ms + transfer
 *
 * The regex form is the one that looks like the obvious optimisation and is 390x worse,
 * because a per-row function call cannot use an index. `max(code)` over the existing
 * `(organization_id, code)` index reads a single index tuple and stops.
 *
 * Assumption, and it is the generator's own: codes are zero-padded to a fixed width, so
 * lexicographic order matches numeric order. That holds until the counter passes 10^pad
 * (`P-100000` sorts below `P-99999`) — the same ceiling the padded scheme has anyway. The
 * unique index on (organization_id, code) stays the backstop either way.
 */
export async function nextCodes(opts: {
  table: PgTable;
  orgCol: PgColumn;
  codeCol: PgColumn;
  orgId: string;
  prefix: string;
  pad: number;
  count?: number;
}): Promise<string[]> {
  const { table, orgCol, codeCol, orgId, prefix, pad, count = 1 } = opts;

  const [row] = await db
    .select({ max: sql<string | null>`max(${codeCol})` })
    .from(table)
    .where(and(eq(orgCol, orgId), like(codeCol, `${prefix}-%`)));

  // Only a well-formed PREFIX-<digits> establishes the counter; anything else (a
  // hand-typed "SUP-A1") leaves it at 0, exactly as the per-row regex scan did.
  const digits = /^[0-9]+$/;
  const tail = row?.max?.slice(prefix.length + 1) ?? "";
  const from = digits.test(tail) ? Number(tail) : 0;

  return Array.from({ length: count }, (_, i) => `${prefix}-${String(from + i + 1).padStart(pad, "0")}`);
}

/** Single-code convenience — the common case (one new supplier / customer). */
export async function nextCode(opts: Omit<Parameters<typeof nextCodes>[0], "count">): Promise<string> {
  return (await nextCodes({ ...opts, count: 1 }))[0];
}
