"use client";

import { useEffect } from "react";

/**
 * When a page is opened with `?print=1` (the report generator does this for the
 * PDF option), fire the browser print dialog once the content has painted, then
 * strip the flag so a refresh doesn't re-print. Mounted globally in the app shell.
 */
export function PrintTrigger() {
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("print") !== "1") return;
    url.searchParams.delete("print");
    window.history.replaceState(null, "", url.toString());
    const t = setTimeout(() => window.print(), 600);
    return () => clearTimeout(t);
  }, []);
  return null;
}
