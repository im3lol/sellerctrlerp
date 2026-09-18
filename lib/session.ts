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
  // Revoked by «اخرج من كل الأجهزة» or an admin password reset. Tokens from before the
  // column existed carry no version and count as 0, so the rollout logs nobody out.
  if (((session.user as { sv?: number }).sv ?? 0) !== u.sessionVersion) return null;
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
  // `expired` tells the proxy not to bounce a still-present (but revoked/inactive) token
  // straight back to /apps — that was a redirect loop.
  if (!user) redirect("/login?expired=1");
  return user;
}

/** Require a capability; redirect to /dashboard if the user lacks it. */
export async function requireCapability(capability: Capability): Promise<SessionUser> {
  const user = await requireUser();
  if (!can(user.role, capability)) redirect("/apps");
  return user;
}
