import "server-only";
import IORedis from "ioredis";

// Shared ioredis connection for BullMQ (producers + workers). BullMQ requires
// `maxRetriesPerRequest: null` on the connection it blocks on. One connection is
// reused process-wide.
let conn: IORedis | null = null;

export function redisEnabled(): boolean {
  return !!process.env.REDIS_URL;
}

let fast: IORedis | null = null;
/** A second connection for health probes and counters: no offline queue and one retry, so a
 *  Redis outage fails these commands at once instead of parking them forever (the BullMQ
 *  connection above waits indefinitely by design). Null when Redis isn't configured. */
export function fastRedis(): IORedis | null {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  if (!fast) fast = new IORedis(url, { enableOfflineQueue: false, maxRetriesPerRequest: 1, connectTimeout: 3000 });
  return fast;
}

export function redisConnection(): IORedis {
  if (!conn) {
    const url = process.env.REDIS_URL;
    if (!url) throw new Error("REDIS_URL غير مضبوط — الطابور غير متاح");
    conn = new IORedis(url, { maxRetriesPerRequest: null });
  }
  return conn;
}
