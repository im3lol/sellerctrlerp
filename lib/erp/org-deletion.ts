import "server-only";
import { and, eq, inArray, isNotNull, lt, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { organizations, orgSubscriptions } from "@/db/schema";
import { withPlatformScope } from "@/lib/db-scope";
import { log } from "@/lib/log";

/** Days between the owner's request and the actual delete — time to change their mind. */
export const DELETION_GRACE_DAYS = 14;

export function deletionDueAt(requestedAt: Date): Date {
  return new Date(requestedAt.getTime() + DELETION_GRACE_DAYS * 86_400_000);
}

/**
 * Daily cron step: delete companies whose deletion grace period has passed, and demo
 * companies whose trial ended. Every tenant table cascades from organizations. The nightly
 * pg_dump (14-day retention) is the last-resort copy after this.
 */
export async function purgeDueOrganizations(now = new Date()): Promise<number> {
  return withPlatformScope(async () => {
    const cutoff = new Date(now.getTime() - DELETION_GRACE_DAYS * 86_400_000);
    const expiredSandboxes = db.select({ id: orgSubscriptions.organizationId }).from(orgSubscriptions)
      .where(lt(orgSubscriptions.expiresAt, now));
    const gone = await db.delete(organizations)
      .where(or(
        and(isNotNull(organizations.deletionRequestedAt), lt(organizations.deletionRequestedAt, cutoff)),
        and(eq(organizations.isSandbox, true), inArray(organizations.id, expiredSandboxes)),
      ))
      .returning({ id: organizations.id, name: organizations.nameAr, sandbox: organizations.isSandbox });
    for (const o of gone) log.warn("org.purged", { orgId: o.id, name: o.name, sandbox: o.sandbox });
    return gone.length;
  });
}
