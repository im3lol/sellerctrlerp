"use client";

import { createContext, useContext, useMemo } from "react";
import { DEFAULT_LOCALE, translator, type Locale, type T } from "@/lib/i18n";

const LocaleContext = createContext<Locale>(DEFAULT_LOCALE);

/** Put the server-resolved locale in reach of every client component. */
export function LocaleProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export const useLocale = (): Locale => useContext(LocaleContext);

/** `const t = useT()` in a client component. */
export function useT(): T {
  const locale = useLocale();
  return useMemo(() => translator(locale), [locale]);
}
