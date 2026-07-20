/**
 * In-process pub/sub for live ERP change events, keyed by organization. The web
 * app shell (cookie SSE) and the mobile app (bearer SSE) both subscribe; every
 * mutation emits through the audit trail (see lib/erp/audit.ts). Single-process
 * only — fine for the self-hosted Node server (Docker now, a real server later),
 * NOT for multi-instance serverless. ponytail: swap to Redis pub/sub if the app
 * ever runs on more than one instance.
 */
export type ErpEvent = {
  action: string; // CREATE | CONFIRM | POST | CANCEL | ...
  entity: string; // entityType, e.g. SALES_ORDER
  id?: string | null;
  number?: string | null;
  at: number;
};

type Sub = (e: ErpEvent) => void;
const subs = new Map<string, Set<Sub>>();

export function subscribeErp(orgId: string, cb: Sub): () => void {
  let set = subs.get(orgId);
  if (!set) { set = new Set(); subs.set(orgId, set); }
  set.add(cb);
  return () => {
    const s = subs.get(orgId);
    if (!s) return;
    s.delete(cb);
    if (s.size === 0) subs.delete(orgId);
  };
}

/**
 * Fan an event out to every subscriber of this org. Called from the audit hook,
 * so it may fire inside a transaction that later rolls back — a stray event only
 * costs one client re-fetch that finds nothing new, which is harmless.
 */
export function emitErpEvent(orgId: string, e: Omit<ErpEvent, "at">): void {
  const set = subs.get(orgId);
  if (!set || set.size === 0) return;
  const full: ErpEvent = { ...e, at: Date.now() };
  for (const cb of set) {
    try { cb(full); } catch { /* a broken subscriber must not break the emitter */ }
  }
}
