import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Liveness + readiness probe (Docker healthcheck / reverse proxy / uptime monitor).
// Public by design (no session) — returns only up/down per dependency, never tenant
// data. 200 = ready, 503 = degraded.
//
// Role-aware gating: the WEB container only hard-requires the DB (it still serves pages
// if Redis blips), but the WORKER container also requires Redis + a fresh heartbeat, so
// a wedged/dead job processor goes unhealthy and Docker restarts it. Redis status is
// always reported so an external monitor can alert even when it isn't gating.
export async function GET() {
  const started = Date.now();
  const isWorker = process.env.WORKER === "1";
  let dbOk = false;
  try { await db.execute(sql`select 1`); dbOk = true; } catch { /* down */ }

  let redis: "up" | "down" | "n/a" = "n/a";
  let worker: "up" | "down" | "n/a" = isWorker ? "down" : "n/a";
  if (process.env.REDIS_URL) {
    redis = "down";
    try {
      const { redisConnection } = await import("@/lib/queue/redis");
      const r = redisConnection();
      await r.ping();
      redis = "up";
      if (isWorker) {
        const { WORKER_HEARTBEAT_KEY } = await import("@/lib/queue/worker");
        const beat = await r.get(WORKER_HEARTBEAT_KEY);
        worker = beat && Date.now() - Number(beat) < 120_000 ? "up" : "down";
      }
    } catch { /* redis down */ }
  }

  const ok = dbOk && (!isWorker || (redis === "up" && worker === "up"));
  const body = { ok, db: dbOk ? "up" : "down", redis, worker, ms: Date.now() - started };
  return Response.json(body, { status: ok ? 200 : 503, headers: { "cache-control": "no-store" } });
}
