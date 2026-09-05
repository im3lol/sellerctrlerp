"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ringSaleAction } from "@/app/actions/erp/pos";
import type { ItemSearchResult } from "@/app/actions/erp/item-search";
import {
  enqueue, markSynced, markFailed, retry as retryOne, discard as discardOne,
  prune, syncOrder, type QueuedSale,
} from "@/lib/erp/pos-sync";

/**
 * The browser half of the offline till. All the decisions live in lib/erp/pos-sync.ts;
 * this file only stores the queue, notices the network, and replays.
 *
 * ponytail: localStorage, not IndexedDB. A queue is a few dozen small objects read once —
 * IndexedDB's async cursor buys nothing here. Move to it if a device ever has to hold
 * thousands of sales or the 5MB quota starts biting.
 */

const QUEUE_KEY = "pos:queue:v1";
const CATALOG_KEY = "pos:catalog:v1";

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback; // private mode, quota, corrupt JSON — start empty rather than break the till
  }
}

function write(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ponytail: a full quota fails silently here; the queue survives in memory for this session.
  }
}

/**
 * Items the cashier has scanned before, so the same barcode still resolves with the
 * network down. ponytail: cache-on-scan only — a shop that needs the whole catalogue
 * available offline on day one wants a prefetch when the shift opens.
 */
export function cacheItem(item: ItemSearchResult) {
  const cache = read<Record<string, ItemSearchResult>>(CATALOG_KEY, {});
  cache[item.code.toLowerCase()] = item;
  for (const c of item.codes ?? []) cache[c.code.toLowerCase()] = item;
  write(CATALOG_KEY, cache);
}

export function cachedItem(code: string): ItemSearchResult | null {
  return read<Record<string, ItemSearchResult>>(CATALOG_KEY, {})[code.trim().toLowerCase()] ?? null;
}

// ── the queue as an external store ──────────────────────────────────────
// Two tills open in two tabs must not each hold half the drawer, so the queue lives
// outside React and both tabs read the same snapshot.

const EMPTY: QueuedSale[] = [];
let cache: QueuedSale[] | null = null;
const listeners = new Set<() => void>();

function snapshot(): QueuedSale[] {
  if (cache === null) cache = read<QueuedSale[]>(QUEUE_KEY, EMPTY);
  return cache;
}

function publish(next: QueuedSale[]) {
  cache = prune(next);
  write(QUEUE_KEY, cache);
  for (const l of listeners) l();
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  const fromOtherTab = (e: StorageEvent) => {
    if (e.key !== QUEUE_KEY) return;
    cache = read<QueuedSale[]>(QUEUE_KEY, EMPTY);
    for (const l of listeners) l();
  };
  window.addEventListener("storage", fromOtherTab);
  return () => { listeners.delete(fn); window.removeEventListener("storage", fromOtherTab); };
}

const subscribeOnline = (fn: () => void) => {
  window.addEventListener("online", fn);
  window.addEventListener("offline", fn);
  return () => { window.removeEventListener("online", fn); window.removeEventListener("offline", fn); };
};

export function usePosQueue() {
  const queue = useSyncExternalStore(subscribe, snapshot, () => EMPTY);
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  const [syncing, setSyncing] = useState(false);
  const busy = useRef(false);

  const add = useCallback((sale: QueuedSale) => publish(enqueue(snapshot(), sale)), []);

  /**
   * Replay the queue, one sale at a time. Serial on purpose: the server's idempotency key
   * makes a duplicate harmless, but two in-flight copies of the same sale would still race
   * on stock. One at a time costs nothing at till volumes.
   */
  const sync = useCallback(async (): Promise<{ done: number; failed: number }> => {
    if (busy.current) return { done: 0, failed: 0 };
    busy.current = true;
    setSyncing(true);
    let done = 0, failed = 0;
    try {
      for (const sale of syncOrder(snapshot())) {
        try {
          const r = await ringSaleAction({
            shiftId: sale.shiftId,
            customerId: sale.customerId,
            lines: sale.lines.map((l) => ({ itemId: l.itemId, quantity: l.quantity, unitPrice: l.unitPrice, discount: l.discount })),
            payments: sale.payments.map((p) => ({ method: p.method, amount: p.amount, reference: p.reference ?? null })),
            applyVat: sale.applyVat,
            vatRate: sale.vatRate,
            clientRef: sale.clientRef,
            soldAt: sale.soldAt,
          });
          if (r.ok) { publish(markSynced(snapshot(), sale.clientRef, r.invoiceNumber)); done++; }
          else { publish(markFailed(snapshot(), sale.clientRef, r.error ?? "تعذّر الترحيل")); failed++; }
        } catch {
          // The network dropped again mid-replay. The sale stays PENDING and waits — a
          // transport failure is not a rejected sale.
          break;
        }
      }
    } finally {
      busy.current = false;
      setSyncing(false);
    }
    return { done, failed };
  }, []);

  // Back online → replay, without waiting for the cashier to press anything.
  useEffect(() => {
    if (online && queue.some((s) => s.status === "PENDING")) void sync();
  }, [online, queue, sync]);

  return {
    queue,
    online,
    syncing,
    add,
    sync,
    retry: useCallback((ref: string) => publish(retryOne(snapshot(), ref)), []),
    discard: useCallback((ref: string) => publish(discardOne(snapshot(), ref)), []),
  };
}
