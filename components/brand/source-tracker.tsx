"use client";

import { useEffect } from "react";

/**
 * First-touch acquisition capture. On the public landing, stores where the visitor
 * came from (utm_source / ref param, else the external referring host, else "direct")
 * in a 30-day `sc_src` cookie — ONCE (first touch wins). The signup wizard reads it so
 * the tenant's origin survives the landing → /signup navigation (which drops the query).
 * Renders nothing.
 */
export function SourceTracker() {
  useEffect(() => {
    if (document.cookie.split("; ").some((c) => c.startsWith("sc_src="))) return; // first-touch only
    const p = new URLSearchParams(window.location.search);
    let src = p.get("utm_source") || p.get("ref") || p.get("source") || "";
    if (!src && document.referrer) {
      try {
        const host = new URL(document.referrer).hostname.replace(/^www\./, "");
        if (!host.endsWith("sellerctrl.com")) src = host;
      } catch { /* ignore malformed referrer */ }
    }
    if (!src) src = "direct";
    document.cookie = `sc_src=${encodeURIComponent(src.slice(0, 80))}; path=/; max-age=${60 * 60 * 24 * 30}; samesite=lax`;
  }, []);
  return null;
}
