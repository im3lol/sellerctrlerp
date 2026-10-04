import { EN } from "@/lib/i18n/en";

/**
 * Translation, keyed by the Arabic source string.
 *
 * The whole product was written in Arabic literals, so the Arabic text IS the key:
 * `t("حفظ")` → "Save" in English, and the Arabic itself in Arabic (or whenever a string
 * has no translation yet). Nothing can break from a missing entry — the screen simply
 * stays Arabic — which is what makes translating 5,000 strings in batches safe.
 */
export const LOCALES = ["ar", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "ar";
export const LOCALE_COOKIE = "locale";
export const LOCALE_LABEL: Record<Locale, string> = { ar: "العربية", en: "English" };

export const isLocale = (v: unknown): v is Locale => typeof v === "string" && (LOCALES as readonly string[]).includes(v);
export const dirOf = (locale: Locale) => (locale === "ar" ? "rtl" : "ltr");

export type T = (ar: string) => string;

/**
 * Fill numbered slots in a translated string: `fill(t("من {0} إلى {1}"), [from, to])`.
 * The dictionary key keeps the slots, so an English sentence can put them in its own
 * order — which is why sentences with values in them are keyed this way rather than
 * glued together around separately-translated fragments.
 */
export const fill = (s: string, vals: (string | number | null | undefined)[]): string =>
  s.replace(/\{(\d+)\}/g, (m, i: string) => (Number(i) < vals.length ? String(vals[Number(i)] ?? "") : m));

/** The translator for a locale. Arabic returns the source untouched (zero lookups). */
export function translator(locale: Locale): T {
  if (locale === "ar") return (ar) => ar;
  return (ar) => EN[ar] ?? ar;
}

// ── locale-aware formatting ───────────────────────────────────────────────────
// Numbers stay Latin-digit in both languages (the house rule); only grouping and
// date wording follow the locale.
const numLoc = (l: Locale) => (l === "ar" ? "ar-EG-u-nu-latn" : "en-US");

export const money = (n: number, locale: Locale): string =>
  n.toLocaleString(numLoc(locale), { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const qty = (n: number, locale: Locale): string =>
  n.toLocaleString(numLoc(locale), { maximumFractionDigits: 2 });

export const int = (n: number, locale: Locale): string => n.toLocaleString(numLoc(locale));

export const date = (d: Date | string, locale: Locale, withTime = false): string =>
  new Intl.DateTimeFormat(locale === "ar" ? "ar-EG-u-nu-latn" : "en-GB", {
    dateStyle: "medium", ...(withTime ? { timeStyle: "short" } : {}),
  }).format(typeof d === "string" ? new Date(d) : d);
