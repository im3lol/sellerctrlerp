import { translator, type Locale } from "@/lib/i18n";

type Cell = string | number | null | undefined;

/**
 * An export sheet in the reader's language. Export routes build their headers, labels and
 * sheet names in Arabic like the rest of the server code; this translates them on the way
 * out instead of touching ~30 routes. A text cell is translated only when the whole cell is
 * a dictionary entry — names, notes and numbers pass through untouched. A header that ends
 * in a parenthesised suffix the route filled in, e.g. "إجمالي البند (EGP)", is translated by
 * its prefix and keeps the suffix as is.
 */
export function localizeTable(aoa: Cell[][], sheet: string, locale: Locale): { aoa: Cell[][]; sheet: string; rtl: boolean } {
  if (locale === "ar") return { aoa, sheet, rtl: true };
  const t = translator(locale);
  const cell = (c: Cell): Cell => {
    if (typeof c !== "string" || !/[؀-ۿ]/.test(c)) return c;
    const whole = t(c);
    if (whole !== c) return whole;
    const m = /^(.+?) \(([^()]*)\)$/.exec(c);
    if (m && t(m[1]) !== m[1]) return `${t(m[1])} (${t(m[2])})`;
    return c;
  };
  return { aoa: aoa.map((row) => row.map(cell)), sheet: String(cell(sheet)), rtl: false };
}
