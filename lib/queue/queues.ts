import "server-only";
import { Queue, type JobsOptions } from "bullmq";
import { redisConnection, redisEnabled } from "./redis";

// The six Amazon sync queues (producer side). Workers live in ./worker.ts and run
// only in the worker container. Job state lives in Redis; sync_runs is the durable log.
export const QUEUES = {
  import: "amazon-import",       // one-time full catalog import (Reports API)
  discovery: "amazon-discovery", // incremental new/changed listings
  details: "amazon-details",     // per-item catalog details (brand/dims/barcodes/family)
  images: "amazon-images",       // per-item image enrichment
  codes: "amazon-codes",         // FNSKU backfill onto existing items (FBA Inventory API)
  orders: "amazon-orders",       // near-real-time incremental order polling
  settlements: "amazon-settlements", // scheduled settlement report pulls (payments)
  pricing: "amazon-pricing",     // fee estimates (Product Fees API)
  inventory: "amazon-inventory", // read-only Inventory Auditor
  returns: "amazon-returns",     // FBA customer returns -> DRAFT مرتجعات
  removals: "amazon-removals",   // FBA removal orders -> DRAFT تسويات مخزون (on trader confirm)
  reimbursements: "amazon-reimbursements", // FBA reimbursements feed (read-only)
  ledger: "amazon-ledger",       // FBA ledger detail feed (read-only)
  maintenance: "maintenance",    // per-tenant daily backup (fans the cron out of one serial loop)
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

/** One sync job. `since` (ISO) makes DISCOVERY incremental; `asins` scopes an
 *  enrichment job to a subset; `userId` is the actor for jobs that write documents. */
export type SyncJob = { orgId: string; provider: string; marketplaceId?: string; since?: string; asins?: string[]; userId?: string; ordersMode?: "created" | "updated" };

const cache = new Map<QueueName, Queue>();
function getQueue(name: QueueName): Queue {
  let q = cache.get(name);
  if (!q) { q = new Queue(name, { connection: redisConnection() }); cache.set(name, q); }
  return q;
}

/** Enqueue a sync job. No-op (returns false) when Redis isn't configured, so the
 *  app degrades gracefully to the in-process fallback path. */
export async function enqueue(name: QueueName, data: SyncJob, opts?: JobsOptions): Promise<boolean> {
  if (!redisEnabled()) return false;
  await getQueue(name).add(name, data, {
    removeOnComplete: 500,
    removeOnFail: 200,
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    ...opts,
  });
  return true;
}
