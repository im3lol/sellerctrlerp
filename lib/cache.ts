import "server-only";
import { sharedCacheAvailable, cachedShared, bustShared } from "@/lib/redis-cache";

// TTL memo for expensive READ-ONLY reports/config so a view doesn't recompute from raw SQL
// on every load — cutting the per-request DB connection-hold that dominates at scale. When
// Redis is configured it's a SHARED cache across replicas/workers (lib/redis-cache); else an
// in-process Map (fine for a single VPS). Keys are tenant-scoped either way. Short TTL bounds
// staleness; MAX bounds the local map. NEVER cache writes or per-user data here.
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

/** Memoize `fn`'s result under `key` for `ttlMs`. Shared via Redis when available, else an
 *  in-process Map. Cache hit returns the stored value; a miss runs `fn` and stores it. */
export async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  if (sharedCacheAvailable()) return cachedShared(key, ttlMs, fn);
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

/** Invalidate every cache key beginning with `prefix` — in the local map AND the shared
 *  Redis cache. Call after a write that changes a cached read (e.g. a settlement post). */
export async function bust(prefix: string): Promise<void> {
  for (const k of [...store.keys()]) if (k.startsWith(prefix)) store.delete(k);
  await bustShared(prefix);
}

/** Test/ops hook: clear the in-process map (e.g. after a bulk import in the same process). */
export function clearCache(): void { store.clear(); }
