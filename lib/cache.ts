import "server-only";

// Tiny in-process TTL memo for expensive READ-ONLY reports (P&L, aging) so a dashboard
// view doesn't recompute from raw SQL on every load — cutting the per-request DB
// connection-hold that dominates at scale. Per-instance (fine for a single VPS; each
// replica keeps its own cache, still correct because keys are tenant-scoped). Short TTL
// bounds staleness; MAX bounds memory. NEVER cache writes or per-user data here.
type Entry = { value: unknown; expires: number };
const store = new Map<string, Entry>();
const MAX = 2000;

/**
 * Build a cache key that ALWAYS begins with the tenant id, so org A's cached report can
 * never be served to org B (the one and only correctness rule of caching in a
 * multi-tenant app). Every caller MUST key through this.
 */
export function orgKey(orgId: string, ...parts: (string | number | null | undefined)[]): string {
  return `${orgId}|${parts.map((p) => (p == null ? "∅" : String(p))).join("|")}`;
}

/** Memoize `fn`'s result under `key` for `ttlMs`. Cache hit returns the stored value; a
 *  miss runs `fn` in the caller's scope and stores it. */
export async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.expires > now) return hit.value as T;
  const value = await fn();
  if (store.size >= MAX) {
    for (const [k, e] of store) if (e.expires <= now) store.delete(k); // sweep expired
    if (store.size >= MAX) store.delete(store.keys().next().value as string); // else drop oldest
  }
  store.set(key, { value, expires: now + ttlMs });
  return value;
}

/** Test/ops hook: clear everything (e.g. after a bulk import in the same process). */
export function clearCache(): void { store.clear(); }
