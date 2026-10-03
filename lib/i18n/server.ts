import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/db/schema";
import { auth } from "@/auth";
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale, translator, type Locale, type T } from "@/lib/i18n";

/**
 * The caller's language, per user. The cookie is the fast path (set by the switcher and
 * at sign-in) so public pages and every server render answer without a query; the stored
 * `users.locale` is what makes the choice follow the person to another device.
 * Cached per request — the layout, the page and its actions all share one resolution.
 */
export const getLocale = cache(async (): Promise<Locale> => {
  const fromCookie = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(fromCookie)) return fromCookie;
  const session = await auth().catch(() => null);
  const id = session?.user?.id;
  if (!id) return DEFAULT_LOCALE;
  const [u] = await db.select({ locale: users.locale }).from(users).where(eq(users.id, id)).limit(1);
  return isLocale(u?.locale) ? u.locale : DEFAULT_LOCALE;
});

/** `const t = await getT()` in any server component, action or route. */
export const getT = cache(async (): Promise<T> => translator(await getLocale()));
