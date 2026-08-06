import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Liveness + readiness probe for the VPS (Docker healthcheck / reverse proxy / uptime
// monitor). Public by design (no session) — returns only up/down + DB reachability,
// never any tenant data. 200 = ready, 503 = degraded.
export async function GET() {
  const started = Date.now();
  let dbOk = false;
  try {
    await db.execute(sql`select 1`);
    dbOk = true;
  } catch { /* dbOk stays false */ }
  const body = { ok: dbOk, db: dbOk ? "up" : "down", ms: Date.now() - started };
  return Response.json(body, { status: dbOk ? 200 : 503, headers: { "cache-control": "no-store" } });
}
