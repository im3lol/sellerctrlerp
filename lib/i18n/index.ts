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

/** The translator for a locale. Arabic returns the source untouched (zero lookups).
 *  An exact entry wins; failing that, a sentence that was built around values on the
 *  server (`الصنف ${code} غير موجود`) is matched against the entries that have slots
 *  ("الصنف {0} غير موجود") — so messages and stored descriptions translate without the
 *  code that wrote them knowing about languages. */
export function translator(locale: Locale): T {
  if (locale === "ar") return (ar) => ar;
  return (ar) => EN[ar] ?? matchPattern(ar) ?? ar;
}

// ── sentences with values ─────────────────────────────────────────────────────
type Pattern = { re: RegExp; en: string; slots: string[]; weight: number };
const SLOT = /\{(\w+)\}/g;
const AR = /[\u0600-\u06FF]/;
let index: Map<string, Pattern[]> | null = null;

const firstWord = (s: string) => s.trimStart().split(/\s+/, 1)[0] ?? "";

/** Built once, on the first miss: every entry with a slot becomes an anchored regex,
 *  bucketed by its first word (or "" when it starts with a slot), most specific first. */
function patterns(): Map<string, Pattern[]> {
  if (index) return index;
  index = new Map();
  for (const [key, en] of Object.entries(EN)) {
    if (!key.includes("{")) continue;
    const fixed = key.replace(SLOT, "");
    if ((fixed.match(/[\u0600-\u06FF]/g) ?? []).length < 4) continue; // too little to anchor on
    const slots: string[] = [];
    const source = key.split(SLOT).map((part, i) => {
      if (i % 2 === 1) { slots.push(part); return "([\\s\\S]+?)"; }
      return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }).join("");
    // Bucket by the first word only when that word is wholly fixed text ("الصنف {0}"), not
    // when a slot starts the key or is glued to its first word ("بـ{0}").
    const prefix = key.slice(0, key.indexOf("{")).trimStart();
    const head = /\s/.test(prefix) ? firstWord(prefix) : "";
    const list = index.get(head) ?? [];
    list.push({ re: new RegExp(`^${source}$`), en, slots, weight: fixed.length });
    index.set(head, list);
  }
  for (const list of index.values()) list.sort((a, b) => b.weight - a.weight);
  return index;
}

function matchPattern(s: string): string | null {
  if (!AR.test(s) || s.length > 600) return null;
  const idx = patterns();
  for (const list of [idx.get(firstWord(s)), idx.get("")]) {
    if (!list) continue;
    for (const p of list) {
      const m = p.re.exec(s);
      if (!m) continue;
      const vals = new Map(p.slots.map((name, i) => [name, m[i + 1]]));
      // A value that is itself a label ("فاتورة بيع") translates too; names and numbers don't.
      return p.en.replace(SLOT, (whole, name: string) => {
        const v = vals.get(name);
        return v == null ? whole : EN[v] ?? v;
      });
    }
  }
  return null;
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
