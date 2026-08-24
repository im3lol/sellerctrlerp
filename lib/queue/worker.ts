import "server-only";
import { Worker, type Job } from "bullmq";
import { inArray, eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { syncRuns } from "@/db/schema";
import { withPlatformScope } from "@/lib/db-scope";
import { redisConnection } from "./redis";
import { QUEUES, type QueueName, type SyncJob } from "./queues";
import { runImportJob, runDiscoveryJob, runDetailsJob, runImagesJob, runFbaCodesJob, runOrdersJob, runSettlementsJob, runInventoryAuditJob, runReturnsJob, runRemovalsJob, runReimbursementsJob, runLedgerJob, runPricingJob, runMaintenanceJob } from "./handlers";

// BullMQ workers — run ONLY in the worker container (WORKER=1, booted from
// instrumentation.ts). concurrency + limiter cap how fast we hit Amazon so we stay
// under SP-API rate limits and don't get blocked. `startWorkers` is idempotent.
// Orders must stay near-real-time; report-driven queues (import/settlements) run
// for minutes and share the low per-account reports quota, so they get 1 slot each
// and can't starve order pickup for every tenant.
// ponytail: in-process paced() gates assume ONE worker replica; add a Redis-based
// pacer before raising these or scaling worker containers horizontally.
const CONC: Record<QueueName, number> = {
  "amazon-import": 1,
  "amazon-discovery": 2,
  "amazon-details": 2,
  "amazon-images": 2,
  "amazon-codes": 1,
  "amazon-orders": 5,
  "amazon-settlements": 1,
  "amazon-pricing": 2,
  "amazon-inventory": 2,
  "amazon-returns": 1,
  "amazon-removals": 1,
  "amazon-reimbursements": 1,
  "amazon-ledger": 1,
  "maintenance": 3, // per-tenant daily backups fan out — a few at a time is plenty
};
const LIMITER = { max: 10, duration: 1000 }; // ≤10 jobs/sec across a queue

let started = false;
let closing = false;
const workers: Worker[] = [];
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
/** Liveness key: the worker refreshes it on an interval; /api/health (WORKER=1) 503s
 *  when it goes stale so a wedged event loop / dead worker gets restarted by Docker. */
export const WORKER_HEARTBEAT_KEY = "worker:heartbeat";

export function startWorkers(): void {
  if (started) return;
  started = true;
  const connection = redisConnection();

  // This container is the only job processor, so any RUNNING run predating this
  // boot died with the previous process (deploy/crash killed it before finishRun).
  // Close them now — otherwise the scheduler's is-running dedup blocks new syncs
  // for the whole stale window (60 min) after every restart.
  void withPlatformScope(() =>
    db.update(syncRuns).set({ status: "FAILED", finishedAt: new Date(), error: "توقّف بإعادة تشغيل الخادم" })
      .where(and(inArray(syncRuns.kind, ["ORDERS", "SETTLEMENTS", "RETURNS", "REIMBURSEMENTS", "LEDGER", "PRICING"]), eq(syncRuns.status, "RUNNING"))),
  ).catch((e) => console.error("[queue] orphan-run reap failed:", e));

  const make = (name: QueueName, handler: (data: SyncJob) => Promise<void>) => {
    const w = new Worker(name, (job: Job<SyncJob>) => handler(job.data), { connection, concurrency: CONC[name] ?? 2, limiter: LIMITER });
    w.on("failed", (job, err) => console.error(`[queue] ${name} job ${job?.id} failed:`, err?.message));
    workers.push(w);
    return w;
  };

  make(QUEUES.import, runImportJob);
  make(QUEUES.discovery, runDiscoveryJob);
  make(QUEUES.details, runDetailsJob);
  make(QUEUES.images, runImagesJob);
  make(QUEUES.codes, runFbaCodesJob);
  make(QUEUES.orders, runOrdersJob);
  make(QUEUES.settlements, runSettlementsJob);
  make(QUEUES.inventory, runInventoryAuditJob);
  make(QUEUES.pricing, runPricingJob);
  make(QUEUES.returns, runReturnsJob);
  make(QUEUES.removals, runRemovalsJob);
  make(QUEUES.reimbursements, runReimbursementsJob);
  make(QUEUES.ledger, runLedgerJob);
  make(QUEUES.maintenance, runMaintenanceJob);
  console.log("[queue] Amazon sync workers started");

  // Liveness heartbeat: refresh a short-TTL Redis key so the worker container's
  // healthcheck (via /api/health) can tell a live processor from a wedged event loop
  // or a dead process — and Docker restarts it when the beat goes stale.
  const beat = () => { void connection.set(WORKER_HEARTBEAT_KEY, String(Date.now()), "EX", 90).catch(() => {}); };
  beat();
  heartbeatTimer = setInterval(beat, 30_000);

  // Near-real-time: self-trigger the due-syncs enqueue every minute — no external
  // cron needed. Dynamic import keeps this off the web container's boot path.
  void import("./scheduler").then(({ startScheduler }) => startScheduler(60_000));

  // Real-time ORDER_CHANGE via SQS (no-op unless AWS env is configured).
  void import("./sqs-listener").then((m) => m.startSqsListener()).catch((e) => console.error("[sqs] boot failed:", e));
}

/**
 * Graceful shutdown for SIGTERM/SIGINT (deploy/restart): stop the heartbeat and let
 * BullMQ finish in-flight jobs. `worker.close()` waits for active jobs to complete
 * (up to the container's stop_grace_period) instead of hard-killing them mid-write.
 */
export async function stopWorkers(): Promise<void> {
  if (closing) return;
  closing = true;
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
  await Promise.all(workers.map((w) => w.close().catch((e) => console.error("[queue] worker close failed:", e))));
  console.log("[queue] workers drained");
}
