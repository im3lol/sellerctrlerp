import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { organizations } from "@/db/erp";

/**
 * Start (YYYY-MM-DD) of the fiscal year that contains `ref`. The org's
 * fiscalYearStart is a stored date but only its MONTH/DAY matter — the fiscal
 * year recurs every calendar year. Empty/unset = Jan 1, i.e. the calendar year,
 * so orgs that never set it get byte-identical report periods to before.
 *
 * Example: fiscalYearStart month/day = Jul 1. On 2026-03-10 the current fiscal
 * year began 2025-07-01; on 2026-09-10 it began 2026-07-01.
 */
export function fiscalYearStartISO(fyStart: string | null | undefined, ref: Date = new Date()): string {
  const parts = (fyStart || "").split("-");
  const month = Number(parts[1]) || 1; // 1–12
  const day = Number(parts[2]) || 1;
  const pad = (n: number) => String(n).padStart(2, "0");
  const y = ref.getFullYear();
  const anchor = `${y}-${pad(month)}-${pad(day)}`;
  const today = `${y}-${pad(ref.getMonth() + 1)}-${pad(ref.getDate())}`;
  // Before this year's fiscal start → the current fiscal year began last year.
  return today >= anchor ? anchor : `${y - 1}-${pad(month)}-${pad(day)}`;
}

/** Async wrapper: reads the org's configured fiscalYearStart, then computes the current FY start. */
export async function orgFiscalYearStartISO(orgId: string, ref: Date = new Date()): Promise<string> {
  const [org] = await db.select({ f: organizations.fiscalYearStart })
    .from(organizations).where(eq(organizations.id, orgId)).limit(1);
  return fiscalYearStartISO(org?.f, ref);
}
