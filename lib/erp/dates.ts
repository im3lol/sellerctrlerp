/**
 * Parse a user-supplied date string, returning null for missing/invalid input.
 * A raw `new Date("garbage")` yields an Invalid Date whose `.toISOString()`
 * throws "RangeError: Invalid time value" when Drizzle serializes it — 500-ing
 * the request. Always guard form/URL dates through this.
 */
export function parseDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
