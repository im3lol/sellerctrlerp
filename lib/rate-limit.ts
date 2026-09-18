import "server-only";
import { redisConnection, redisEnabled } from "@/lib/queue/redis";

// Rate limiter for the unauthenticated endpoints (login, public signup). Backed by Redis so
// the count survives a container restart/deploy and is shared if the app ever runs more
// than one replica; falls back to an in-process window when Redis is off or slow. Never throws.
const hits = new Map<string, number[]>();
const REDIS_TIMEOUT_MS = 300;

/**
 * Best available client IP. `x-forwarded-for` is caller-controlled — anyone can send their
 * own — so the proxy-set headers come first: Cloudflare's cf-connecting-ip, then x-real-ip,
 * and XFF only as a last resort. "unknown" buckets everyone with no header together.
 */
export function clientIp(h: { get(name: string): string | null }): string {
  const cf = h.get("cf-connecting-ip")?.trim();
  if (cf) return cf;
  const real = h.get("x-real-ip")?.trim();
  if (real) return real;
  return (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
}

function memoryLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const arr = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= max) { hits.set(key, arr); return false; }
  arr.push(now);
  hits.set(key, arr);
  // Opportunistic cleanup so the map can't grow unbounded under a spray of distinct keys.
  if (hits.size > 5000) for (const [k, v] of hits) if (v.every((t) => now - t > windowMs)) hits.delete(k);
  return true;
}

/** Returns true if this key may act now, false once it has used `max` actions within
 *  `windowMs`. Records the action when allowed. */
export async function rateLimit(key: string, max: number, windowMs: number): Promise<boolean> {
  if (!redisEnabled()) return memoryLimit(key, max, windowMs);
  // ponytail: fixed window (a burst can straddle two windows → up to 2×max); a sorted-set
  // sliding window if that ever matters for these limits.
  const k = `rl:${key}:${Math.floor(Date.now() / windowMs)}`;
  try {
    const n = await Promise.race([
      (async () => {
        const r = redisConnection();
        const count = await r.incr(k);
        if (count === 1) await r.pexpire(k, windowMs);
        return count;
      })(),
      // The shared connection queues commands forever while Redis is down — don't let a
      // login hang on it.
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("redis timeout")), REDIS_TIMEOUT_MS)),
    ]);
    return n <= max;
  } catch {
    return memoryLimit(key, max, windowMs);
  }
}
