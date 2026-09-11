/**
 * How long to leave a sync kind alone after it failed, by how many times in a row.
 *
 * The scheduler re-enqueues a due sync on every tick (about a minute). A sync that
 * fails never advances its watermark, so it stays "due" — and Noon's discovery was
 * retried 266 times a day, 67% of them failing, for a platform with no orders. Each
 * consecutive failure now waits longer before the next attempt; one success resets it.
 *
 * Pure: the caller passes the newest runs first. No imports, so it tests without a DB.
 */

const STEPS_MIN = [1, 5, 30, 120];

export function backoffUntil(recentNewestFirst: { status: string; startedAt: Date | string }[]): Date | null {
  let fails = 0;
  for (const r of recentNewestFirst) {
    if (r.status !== "FAILED") break;
    fails++;
  }
  if (fails === 0) return null;
  const waitMin = STEPS_MIN[Math.min(fails, STEPS_MIN.length) - 1];
  return new Date(new Date(recentNewestFirst[0].startedAt).getTime() + waitMin * 60_000);
}

/** How many recent runs the caller needs to fetch to reach the longest step. */
export const BACKOFF_LOOKBACK = STEPS_MIN.length;
