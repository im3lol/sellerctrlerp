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
  // Clamp to a real date for the target year — a Feb-29 start in a non-leap year
  // would otherwise emit "YYYY-02-29" → Invalid Date → reports silently unfiltered.
  const mk = (yy: number) => `${yy}-${pad(month)}-${pad(Math.min(day, new Date(yy, month, 0).getDate()))}`;
  const y = ref.getFullYear();
  const anchor = mk(y);
  const today = `${y}-${pad(ref.getMonth() + 1)}-${pad(ref.getDate())}`;
  // Before this year's fiscal start → the current fiscal year began last year.
  return today >= anchor ? anchor : mk(y - 1);
}

/**
 * Bounds (+ Arabic name) of the fiscal year that CONTAINS `ref`, honoring the org's
 * fiscalYearStart month/day. Computed in UTC (the ledger's convention) so period rows
 * are deterministic. Empty/unset = calendar year, byte-identical to the legacy
 * fiscalYearBounds(year): Jan 1 00:00:00 → Dec 31 23:59:59, name "السنة المالية YYYY".
 * A non-Jan start spans two calendar years → name "السنة المالية YYYY/YYYY+1".
 */
export function fiscalYearBoundsFor(
  fyStart: string | null | undefined,
  ref: Date = new Date(),
): { startDate: Date; endDate: Date; name: string } {
  const parts = (fyStart || "").split("-");
  const month = Number(parts[1]) || 1; // 1–12
  const dayRaw = Number(parts[2]) || 1;
  // Clamp the day to the target month's length per year (Feb-29 start in a non-leap year).
  const clampDay = (yy: number) => Math.min(dayRaw, new Date(Date.UTC(yy, month, 0)).getUTCDate());
  // The FY start year that contains `ref`: this year's start if ref is on/after it, else last year's.
  const refY = ref.getUTCFullYear();
  const startThisYear = Date.UTC(refY, month - 1, clampDay(refY), 0, 0, 0);
  const y = ref.getTime() >= startThisYear ? refY : refY - 1;
  const startDate = new Date(Date.UTC(y, month - 1, clampDay(y), 0, 0, 0));
  const endDate = new Date(Date.UTC(y + 1, month - 1, clampDay(y + 1), 0, 0, 0) - 1000); // next start − 1s
  const endYear = endDate.getUTCFullYear();
  const name = y === endYear ? `السنة المالية ${y}` : `السنة المالية ${y}/${endYear}`;
  return { startDate, endDate, name };
}

/** Async wrapper: reads the org's configured fiscalYearStart, then computes the current FY start. */
export async function orgFiscalYearStartISO(orgId: string, ref: Date = new Date()): Promise<string> {
  const [org] = await db.select({ f: organizations.fiscalYearStart })
    .from(organizations).where(eq(organizations.id, orgId)).limit(1);
  return fiscalYearStartISO(org?.f, ref);
}
