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
 * Reuses a matching tenant transaction. A different tenant is rejected. Narrowing a
 * platform bootstrap opens a separate connection so it cannot inherit the RLS bypass;
 * its parent transaction's settings remain untouched, including during parallel reads.
 * Do not use this boundary to split writes that must commit atomically together.
 */
export function withOrgScope<T>(orgId: string, isAdmin: boolean, fn: () => Promise<T>): Promise<T> {
  if (!orgId || isAdmin) throw new Error("Tenant scope requires a company and cannot bypass RLS");
  const existing = scopeStore.getStore();
  if (existing && !existing.isPlatform) {
    if (existing.orgId !== orgId) throw new Error("Cannot switch company inside a tenant transaction");
    return fn();
  }
  return realDb.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.current_org', ${orgId}, true), set_config('app.is_platform_admin', ${isAdmin ? "on" : "off"}, true)`,
    );
    return scopeStore.run({ tx, orgId, isPlatform: false }, fn);
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
  // A tenant caller stays restricted; a nested helper cannot elevate its transaction.
  if (scopeStore.getStore()) return fn();
  return realDb.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.current_org', '', true), set_config('app.is_platform_admin', 'on', true)`,
    );
    return scopeStore.run({ tx, orgId: "", isPlatform: true }, fn);
  });
}

/** A fresh, read-only snapshot of committed company data, even inside a caller scope. */
export function withOrgSnapshot<T>(orgId: string, fn: () => Promise<T>): Promise<T> {
  if (!orgId) throw new Error("Snapshot requires a company");
  const existing = scopeStore.getStore();
  if (existing && !existing.isPlatform && existing.orgId !== orgId) throw new Error("Cannot switch company inside a snapshot");
  return realDb.transaction(async tx => {
    await tx.execute(sql`select set_config('app.current_org', ${orgId}, true), set_config('app.is_platform_admin', 'off', true)`);
    return scopeStore.run({ tx, orgId, isPlatform: false }, fn);
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
