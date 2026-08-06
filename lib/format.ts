/** Relative time in Arabic, e.g. "قبل 3 دقائق". */
export function relativeTimeAr(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const diff = Math.floor((Date.now() - d.getTime()) / 1000);

  if (diff < 60) return "الآن";
  if (diff < 3600) {
    const m = Math.floor(diff / 60);
    return `قبل ${m} دقيقة`;
  }
  if (diff < 86400) {
    const h = Math.floor(diff / 3600);
    return `قبل ${h} ساعة`;
  }
  if (diff < 604800) {
    const days = Math.floor(diff / 86400);
    return `قبل ${days} يوم`;
  }
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(d);
}

/** Absolute date in Arabic. */
export function formatDateAr(date: Date | string, withTime = false): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    ...(withTime ? { timeStyle: "short" } : {}),
  }).format(d);
}

/** Number formatting with Arabic locale grouping. */
export function formatNumberAr(n: number): string {
  return new Intl.NumberFormat("ar-u-nu-latn").format(n);
}

// Canonical ON-SCREEN money/quantity formatters — one source of truth for the
// `n.toLocaleString("ar-EG-u-nu-latn", { …fractionDigits })` pattern that was inlined
// across ~100 components. Byte-identical to those inline calls (same locale + digits),
// so adopting them changes nothing visually. (Print/PDF money lives in print-format.ts.)
const MONEY_LOC = "ar-EG-u-nu-latn";

/** Money: Latin-digit Arabic grouping, always 2 decimals (e.g. 1٬234.50). */
export const fmtMoney = (n: number): string =>
  n.toLocaleString(MONEY_LOC, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Quantity: same locale, up to 2 decimals, no forced trailing zeros. */
export const fmtQty = (n: number): string =>
  n.toLocaleString(MONEY_LOC, { maximumFractionDigits: 2 });
