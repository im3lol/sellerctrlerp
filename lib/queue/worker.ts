import "server-only";
import { Worker, type Job } from "bullmq";
import { inArray, eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { syncRuns } from "@/db/schema";
import { withPlatformScope } from "@/lib/db-scope";
import { redisConnection } from "./redis";
import { QUEUES, type QueueName, type SyncJob } from "./queues";
import { runImportJob, runDiscoveryJob, runDetailsJob, runImagesJob, runOrdersJob, runSettlementsJob, runInventoryAuditJob } from "./handlers";

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
  "amazon-orders": 5,
  "amazon-settlements": 1,
  "amazon-pricing": 2,
  "amazon-inventory": 2,
};
const LIMITER = { max: 10, duration: 1000 }; // ≤10 jobs/sec across a queue

let started = false;

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
      .where(and(inArray(syncRuns.kind, ["ORDERS", "SETTLEMENTS"]), eq(syncRuns.status, "RUNNING"))),
  ).catch((e) => console.error("[queue] orphan-run reap failed:", e));

  const make = (name: QueueName, handler: (data: SyncJob) => Promise<void>) => {
    const w = new Worker(name, (job: Job<SyncJob>) => handler(job.data), { connection, concurrency: CONC[name] ?? 2, limiter: LIMITER });
    w.on("failed", (job, err) => console.error(`[queue] ${name} job ${job?.id} failed:`, err?.message));
    return w;
  };

  make(QUEUES.import, runImportJob);
  make(QUEUES.discovery, runDiscoveryJob);
  make(QUEUES.details, runDetailsJob);
  make(QUEUES.images, runImagesJob);
  make(QUEUES.orders, runOrdersJob);
  make(QUEUES.settlements, runSettlementsJob);
  make(QUEUES.inventory, runInventoryAuditJob);
  // pricing queue: next.
  console.log("[queue] Amazon sync workers started");

  // Near-real-time: self-trigger the due-syncs enqueue every minute — no external
  // cron needed. Dynamic import keeps this off the web container's boot path.
  void import("./scheduler").then(({ startScheduler }) => startScheduler(60_000));
}
