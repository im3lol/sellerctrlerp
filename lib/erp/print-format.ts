/**
 * Formatting for printed documents. Pure — no db, no React.
 *
 * These four were copy-pasted verbatim into all six print pages (and drifted: some
 * declared `body{font-size}` inside `@media print`, some outside). One home now, so a
 * printed number can't be formatted one way on the invoice and another on the voucher.
 *
 * Locale is `ar-EG-u-nu-latn` — Arabic, but Latin digits. That's the existing
 * convention across the print views and it's deliberate: Arabic-Indic digits on an
 * invoice are hard to reconcile against a bank statement or a supplier's paperwork.
 * Note this differs from lib/format.ts (`ar-u-nu-latn`, and `en-GB` dates) — that one
 * serves the app UI; documents are their own thing and are not being unified with it.
 */

import type { Locale } from "@/lib/i18n";

const LOCALE = "ar-EG-u-nu-latn";
/** An English document keeps the same digits and grouping, with English month names. */
const dateLocale = (l: Locale) => (l === "en" ? "en-GB" : LOCALE);

/** Money-shaped: always 2dp, so a column of amounts lines up. */
export const fmt = (v: string | number | null | undefined) =>
  Number(v ?? 0).toLocaleString(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Quantities: up to 3dp, no trailing zeros — "2" not "2.000". */
export const qty = (v: string | number | null | undefined) =>
  Number(v ?? 0).toLocaleString(LOCALE, { maximumFractionDigits: 3 });

/** Long Arabic date: "١٥ يناير ٢٠٢٦" with Latin digits → "15 يناير 2026". */
export const dt = (d: Date | string | null | undefined, locale: Locale = "ar") =>
  d ? new Date(d).toLocaleDateString(dateLocale(locale), { year: "numeric", month: "long", day: "numeric" }) : "";

/**
 * Currency symbols. Only the ones the app actually seeds plus the obvious majors —
 * anything else falls back to its code, which is honest rather than wrong.
 */
const SYMBOLS: Record<string, string> = {
  EGP: "ج.م",
  USD: "$",
  EUR: "€",
  GBP: "£",
  SAR: "﷼",
  AED: "د.إ",
  KWD: "د.ك",
};
/** In English the Arabic-script symbols read as noise — print the ISO code instead. */
const SYMBOLS_EN: Record<string, string> = { USD: "$", EUR: "€", GBP: "£" };

/**
 * Amount with its currency, e.g. `money(240, "EGP")` → "240.00 ج.م".
 *
 * Every printed amount must go through this. The receipt voucher used to hardcode
 * `﷼` next to a raw number while the org's base currency defaults to EGP — a printed
 * document stating the wrong currency, which is the kind of error a customer acts on.
 * The code comes from getBaseCurrencyCode(orgId) (lib/erp/currency.ts), which no print
 * page was calling.
 */
export const money = (v: string | number | null | undefined, code: string, locale: Locale = "ar") =>
  `${fmt(v)} ${(locale === "en" ? SYMBOLS_EN : SYMBOLS)[code?.toUpperCase()] ?? code}`;

/* ─────────────── amount in words (vouchers) ─────────────── */

const ONES = ["", "واحد", "اثنان", "ثلاثة", "أربعة", "خمسة", "ستة", "سبعة", "ثمانية", "تسعة", "عشرة",
  "أحد عشر", "اثنا عشر", "ثلاثة عشر", "أربعة عشر", "خمسة عشر", "ستة عشر", "سبعة عشر", "ثمانية عشر", "تسعة عشر"];
const TENS = ["", "", "عشرون", "ثلاثون", "أربعون", "خمسون", "ستون", "سبعون", "ثمانون", "تسعون"];
/** Arabic hundreds are single words, not "one hundred" / "two hundred". */
const HUNDREDS = ["", "مئة", "مئتان", "ثلاثمئة", "أربعمئة", "خمسمئة", "ستمئة", "سبعمئة", "ثمانمئة", "تسعمئة"];

const join = (...parts: string[]) => parts.filter(Boolean).join(" و");

/** Recursive worker — returns "" for zero so it can be dropped from a join. */
function words(n: number): string {
  if (n === 0) return "";
  if (n < 20) return ONES[n];
  if (n < 100) {
    const t = TENS[Math.floor(n / 10)], o = ONES[n % 10];
    return o ? `${o} و${t}` : t;
  }
  if (n < 1000) return join(HUNDREDS[Math.floor(n / 100)], words(n % 100));
  if (n < 1_000_000) {
    const k = Math.floor(n / 1000);
    // ألف / ألفان / ثلاثة آلاف / أحد عشر ألفًا — the counted noun changes with the count.
    const unit = k === 1 ? "ألف" : k === 2 ? "ألفان" : k <= 10 ? `${words(k)} آلاف` : `${words(k)} ألفًا`;
    return join(unit, words(n % 1000));
  }
  const m = Math.floor(n / 1_000_000);
  const unit = m === 1 ? "مليون" : m === 2 ? "مليونان" : m <= 10 ? `${words(m)} ملايين` : `${words(m)} مليونًا`;
  return join(unit, words(n % 1_000_000));
}

/**
 * The amount spelled out, for the «فقط وقدره» line on a voucher — the wording that
 * makes a signed voucher hard to alter after the fact.
 *
 * Was defined privately inside the payment-voucher print page and, because every
 * branch appended the remainder unconditionally, a round number came out wrong:
 * 1000 printed «واحد ألف صفر» and 100 printed «واحد مئة صفر». Now the recursion drops
 * zero remainders, and hundreds/thousands use the real Arabic forms.
 *
 * Piastres are ignored — vouchers say «فقط وقدره X جنيهًا لا غير» for the whole part.
 */
export function toArabicWords(n: number): string {
  const whole = Math.floor(Math.abs(Number(n) || 0));
  if (whole === 0) return "صفر";
  return `${n < 0 ? "سالب " : ""}${words(whole)}`;
}

/* ─────────────── amount in words — English ─────────────── */

const EN_ONES = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const EN_TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

function enWords(n: number): string {
  if (n === 0) return "";
  if (n < 20) return EN_ONES[n];
  if (n < 100) return [EN_TENS[Math.floor(n / 10)], EN_ONES[n % 10]].filter(Boolean).join("-");
  if (n < 1000) return [`${EN_ONES[Math.floor(n / 100)]} hundred`, enWords(n % 100)].filter(Boolean).join(" and ");
  for (const [size, name] of [[1_000_000_000, "billion"], [1_000_000, "million"], [1000, "thousand"]] as const) {
    if (n >= size) return [`${enWords(Math.floor(n / size))} ${name}`, enWords(n % size)].filter(Boolean).join(" ");
  }
  return "";
}

/** The whole part spelled out in English — the counterpart of toArabicWords. */
export function toEnglishWords(n: number): string {
  const whole = Math.floor(Math.abs(Number(n) || 0));
  if (whole === 0) return "zero";
  return `${n < 0 ? "minus " : ""}${enWords(whole)}`;
}

/**
 * The «فقط وقدره … لا غير» line in the document's language: "Only … only." reads oddly,
 * so English gets the cheque convention instead — "Amount in words: … only".
 */
export function amountInWords(n: number, locale: Locale = "ar", currencyWord?: string): string {
  if (locale === "en") return `Amount in words: ${toEnglishWords(n)}${currencyWord ? ` ${currencyWord}` : ""} only`;
  return `فقط وقدره ${toArabicWords(n)}${currencyWord ? ` ${currencyWord}` : ""} لا غير`;
}
