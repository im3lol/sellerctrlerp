import { cache } from "react";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { users } from "@/db/schema";
import { can, type Capability, type Role } from "@/lib/rbac";

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
  avatarUrl: string | null;
  title: string | null;
  tourDismissed: boolean;
};

/**
 * Returns the current user (full DB row), or null if not authenticated.
 * Wrapped in React cache() so repeated calls within ONE request (layout +
 * page + actions) share a single auth() + DB lookup instead of re-querying.
 */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  // `auth()` reads request headers/cookies; in a background worker (BullMQ job) there
  // is no request scope, so it throws. `.catch → null` treats that as "no session"
  // instead of crashing the job — actions then fail closed rather than blowing up sync.
  const session = await auth().catch(() => null);
  if (!session?.user?.id) return null;
  const [u] = await db.select().from(users).where(eq(users.id, session.user.id)).limit(1);
  if (!u || !u.isActive) return null;
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role as Role,
    avatarUrl: u.avatarUrl,
    title: u.title,
    tourDismissed: u.tourDismissed,
  };
});

/** Like getCurrentUser but redirects to /login when unauthenticated. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** Require a capability; redirect to /dashboard if the user lacks it. */
export async function requireCapability(capability: Capability): Promise<SessionUser> {
  const user = await requireUser();
  if (!can(user.role, capability)) redirect("/dashboard");
  return user;
}
