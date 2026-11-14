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

/** Current ERP business timezone, shared with Cairo-based follow-up deadlines.
 * Always specify it when rendering dates: the Docker host and browser may differ.
 * A future per-company timezone must be passed consistently to server and client.
 */
export const ERP_TIME_ZONE = "Africa/Cairo";

export function formatErpDate(value: Date | string | number, locale: Intl.LocalesArgument, options: Intl.DateTimeFormatOptions = {}): string {
  return new Date(value).toLocaleDateString(locale, { ...options, timeZone: ERP_TIME_ZONE });
}

export function formatErpDateTime(value: Date | string | number, locale: Intl.LocalesArgument, options: Intl.DateTimeFormatOptions = {}): string {
  return new Date(value).toLocaleString(locale, { ...options, timeZone: ERP_TIME_ZONE });
}
