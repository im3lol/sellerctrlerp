import englishContent from "./content-en.json";
import { translator, type Locale } from "./index";

const dictionary: Readonly<Record<string, string>> = englishContent;

/** Translate authored product documentation while preserving Markdown and links. */
export function translateContent(source: string, locale: Locale): string {
  if (locale === "ar") return source;
  const t = translator(locale);
  return source.split(/(\r?\n\s*\r?\n)/).map((part) => {
    const key = part.trim();
    if (!key) return part;
    const translated = dictionary[key] ?? t(key);
    return part.replace(key, () => translated);
  }).join("");
}
