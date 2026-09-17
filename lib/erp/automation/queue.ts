import { AsyncLocalStorage } from "async_hooks";
import { DOCS, isEvent, MAX_DEPTH } from "@/lib/erp/automation/model";

/**
 * The bridge from the audit trail to the automation worker. recordAudit calls
 * queueAutomation for every audited mutation; it never touches the database (recordAudit
 * often runs inside the action's own transaction, where a failed query would abort the
 * action) and never throws. The worker decides whether any rule cares.
 */

export type AutomationJob = {
  auditId: string;
  entity: string;
  event: string;
  entityId: string;
  entityNumber: string | null;
  /** How many rules deep this event is — a rule's own actions can trigger rules. */
  depth: number;
};

const depthStore = new AsyncLocalStorage<number>();

/** The automation depth of whatever is running now (0 = a person did it). */
export const currentDepth = () => depthStore.getStore() ?? 0;

/** Run a rule's actions so anything they audit is marked one level deeper. */
export const withDepth = <T>(depth: number, fn: () => Promise<T>) => depthStore.run(depth, fn);

export function queueAutomation(orgId: string, job: AutomationJob): void {
  if (!job.entityId || !DOCS[job.entity] || !isEvent(job.event) || job.depth > MAX_DEPTH) return;
  void import("@/lib/queue/queues")
    .then(({ enqueue, QUEUES }) => enqueue(QUEUES.automation, { orgId, provider: "automation", automation: job }, {
      // Give the action's transaction time to commit; the worker checks the audit row exists.
      delay: 3000, attempts: 4, backoff: { type: "fixed", delay: 10_000 },
    }))
    .catch(() => { /* no queue, no automation — never the action's problem */ });
}
