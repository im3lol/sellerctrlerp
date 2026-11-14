"use client";
import { useEffect } from "react";

export function NoticeConsumed({ path, id }: { path: string; id: string }) {
  useEffect(() => {
    if (!id) return;
    if (window.location.hash === "#google-drive") window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
    // A route handler clears the cookie without triggering a Server Action RSC
    // refresh, so the currently visible message remains readable until navigation.
    void fetch("/api/ui/notice", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path, id }), cache: "no-store" }).catch(() => { /* The notice also expires server-side. */ });
  }, [path, id]);
  return null;
}
