import "server-only";

// Tiny in-process sliding-window rate limiter — no dependency, enough to blunt abuse on
// the few unauthenticated endpoints (public signup). Per-container (the app runs as one
// replica); if that ever changes, back it with Redis. Never throws.
const hits = new Map<string, number[]>();

/** Returns true if this key is allowed to act now, false if it exceeded `max` actions
 *  within `windowMs`. Records the action when allowed. */
export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const arr = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= max) { hits.set(key, arr); return false; }
  arr.push(now);
  hits.set(key, arr);
  // Opportunistic cleanup so the map can't grow unbounded under a spray of distinct keys.
  if (hits.size > 5000) for (const [k, v] of hits) if (v.every((t) => now - t > windowMs)) hits.delete(k);
  return true;
}
