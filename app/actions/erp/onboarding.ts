"use server";

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/db/schema";
import { getCurrentUser } from "@/lib/session";

/** Permanently dismiss the onboarding tour for the current user (server-side). */
export async function dismissTourAction(): Promise<{ ok: boolean }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false };
  await db.update(users).set({ tourDismissed: true }).where(eq(users.id, user.id));
  return { ok: true };
}
