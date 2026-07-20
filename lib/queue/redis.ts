import "server-only";
import IORedis from "ioredis";

// Shared ioredis connection for BullMQ (producers + workers). BullMQ requires
// `maxRetriesPerRequest: null` on the connection it blocks on. One connection is
// reused process-wide.
let conn: IORedis | null = null;

export function redisEnabled(): boolean {
  return !!process.env.REDIS_URL;
}

export function redisConnection(): IORedis {
  if (!conn) {
    const url = process.env.REDIS_URL;
    if (!url) throw new Error("REDIS_URL غير مضبوط — الطابور غير متاح");
    conn = new IORedis(url, { maxRetriesPerRequest: null });
  }
  return conn;
}
