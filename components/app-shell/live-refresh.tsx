"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Holds an SSE connection to /api/erp/stream and soft-refreshes the current
 * route whenever any ERP mutation happens (from this tab, another user, or the
 * mobile app). Debounced so a burst of events triggers one refresh. EventSource
 * auto-reconnects on drop.
 */
export function LiveRefresh() {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const es = new EventSource("/api/erp/stream");
    es.onmessage = (ev) => {
      // Ignore the initial HELLO; refresh on real change events.
      try {
        const d = JSON.parse(ev.data);
        if (d?.action === "HELLO") return;
      } catch { /* refresh anyway */ }
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => router.refresh(), 300);
    };
    return () => { es.close(); if (timer.current) clearTimeout(timer.current); };
  }, [router]);

  return null;
}
