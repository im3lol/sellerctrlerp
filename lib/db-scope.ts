import { sql } from "drizzle-orm";
import { realDb, scopeStore } from "@/lib/db";

/**
 * Run `fn` inside a tenant scope: one transaction whose connection carries the
 * `app.current_org` / `app.is_platform_admin` GUCs that RLS policies read. Every query
 * `fn` issues through the `db` proxy runs on that transaction, so it's tenant-isolated
 * at the database, not just by an app-code filter.
 *
 * The GUC is transaction-scoped (`set_config(..., true)`) on purpose: that's the only
 * form that survives a transaction-mode pooler (PgBouncer et al), which hands the server
 * connection back after each transaction.
 *
 * Reuses an already-open scope rather than nesting a second top-level transaction —
 * a request resolves one active org, so a wrapped helper called inside a wrapped guard
 * must not grab a second pooled connection (that would serialize into a self-deadlock
 * at small pool sizes).
 */
export function withOrgScope<T>(orgId: string, isAdmin: boolean, fn: () => Promise<T>): Promise<T> {
  if (scopeStore.getStore()) return fn();
  return realDb.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.current_org', ${orgId}, true), set_config('app.is_platform_admin', ${isAdmin ? "on" : "off"}, true)`,
    );
    return scopeStore.run({ tx }, fn);
  });
}

/**
 * Run `fn` with the platform-admin bypass: RLS policies' `is_platform_admin = 'on'`
 * branch opens every tenant's rows. ONLY for the audited cross-org surfaces — the
 * /admin/** pages (behind the system_admin layout guard) and the cron jobs (behind the
 * cron secret). The normal tenant UI passes isAdmin=false even for a system_admin, so
 * this bypass is reachable only from those few entry points.
 */
export function withPlatformScope<T>(fn: () => Promise<T>): Promise<T> {
  if (scopeStore.getStore()) return fn();
  return realDb.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.current_org', '', true), set_config('app.is_platform_admin', 'on', true)`,
    );
    return scopeStore.run({ tx }, fn);
  });
}
