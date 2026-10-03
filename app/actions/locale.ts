"use server";

import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/db/schema";
import { getCurrentUser } from "@/lib/session";
import { revalidatePath } from "@/lib/safe-revalidate";
import { isLocale, LOCALE_COOKIE, type Locale } from "@/lib/i18n";

/** Switch the interface language. The cookie answers the next render; the user row makes
 *  the choice follow the person to their other devices. Works signed-out too (cookie only). */
export async function setLocaleAction(locale: Locale): Promise<{ ok: boolean }> {
  if (!isLocale(locale)) return { ok: false };
  (await cookies()).set(LOCALE_COOKIE, locale, { path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
  const user = await getCurrentUser();
  if (user) await db.update(users).set({ locale, updatedAt: new Date() }).where(eq(users.id, user.id));
  revalidatePath("/", "layout");
  return { ok: true };
}
