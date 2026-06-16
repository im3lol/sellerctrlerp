"use client";

import { useEffect, useRef } from "react";

export type ClientRealtimeEvent = {
  channel: string;
  type: string;
  payload?: Record<string, unknown>;
  at: string;
};

/**
 * Subscribe to the app-wide SSE stream (/api/realtime/sse).
 * A single EventSource is shared across all hook consumers on the page.
 */
let sharedSource: EventSource | null = null;
let refCount = 0;
const handlers = new Set<(e: ClientRealtimeEvent) => void>();

const EVENT_TYPES = [
  "notification",
  "product_updated",
  "task_moved",
  "activity",
  "attendance",
];

function ensureSource() {
  if (sharedSource) return;
  sharedSource = new EventSource("/api/realtime/sse");
  for (const type of EVENT_TYPES) {
    sharedSource.addEventListener(type, (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data) as ClientRealtimeEvent;
        handlers.forEach((h) => h(data));
      } catch {
        /* ignore */
      }
    });
  }
}

export function useRealtime(handler: (event: ClientRealtimeEvent) => void) {
  const ref = useRef(handler);
  ref.current = handler;

  useEffect(() => {
    const wrapped = (e: ClientRealtimeEvent) => ref.current(e);
    handlers.add(wrapped);
    refCount++;
    ensureSource();

    return () => {
      handlers.delete(wrapped);
      refCount--;
      if (refCount <= 0 && sharedSource) {
        sharedSource.close();
        sharedSource = null;
        refCount = 0;
      }
    };
  }, []);
}
