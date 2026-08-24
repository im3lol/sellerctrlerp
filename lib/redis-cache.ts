import "server-only";
import { redisEnabled, redisConnection } from "@/lib/queue/redis";

// Shared cache backed by the Redis already present for BullMQ — so cached reports/config
// are shared ACROSS web replicas and workers (the in-process Map in lib/cache.ts is per
// replica). JSON values only. Fail-OPEN: if Redis is unavailable or errors, callers fall
// back to recomputing / the in-process cache — never a hard failure.

const NS = "cache:";

/** True when a shared Redis cache is usable (BullMQ Redis is configured). */
export function sharedCacheAvailable(): boolean {
  return redisEnabled();
}

/** Redis GET→hit, else run fn and SET with a PX ttl. Returns null-signal via a thrown
 *  fallback? No — on any Redis error it just runs fn (no caching that call). */
export async function cachedShared<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  if (!redisEnabled()) return fn();
  try {
    const r = redisConnection();
    const hit = await r.get(NS + key);
    if (hit != null) return JSON.parse(hit) as T;
    const value = await fn();
    // Only cache JSON-serialisable, non-undefined values.
    if (value !== undefined) { try { await r.set(NS + key, JSON.stringify(value), "PX", Math.max(1, ttlMs)); } catch { /* ignore */ } }
    return value;
  } catch {
    return fn(); // fail-open
  }
}

/** Delete every shared-cache key beginning with `prefix` (SCAN+DEL). Best-effort. */
export async function bustShared(prefix: string): Promise<void> {
  if (!redisEnabled()) return;
  try {
    const r = redisConnection();
    let cursor = "0";
    do {
      const [next, keys] = await r.scan(cursor, "MATCH", `${NS}${prefix}*`, "COUNT", 300);
      if (keys.length) await r.del(...keys);
      cursor = next;
    } while (cursor !== "0");
  } catch { /* best-effort */ }
}
