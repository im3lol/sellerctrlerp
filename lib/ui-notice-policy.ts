/** Presentation-only flags. Business filters and OAuth protocol parameters are excluded. */
export function noticeKeys(path: string): readonly string[] {
  if (path === "/admin/integrations" || path === "/storage/admin") return ["cloudSaved", "cloudError"];
  if (path === "/storage" || path === "/storage/") return ["created", "error"];
  if (path === "/storage/cloud") return ["connected", "uploaded", "disconnected", "queued", "scheduleSaved", "error"];
  if (path === "/accounting/assets/new") return ["error"];
  if (/^\/platforms\/[a-z0-9_-]{1,64}$/i.test(path)) return ["connected", "err"];
  if (path === "/settings/subscription") return ["xpay"];
  return [];
}

export function splitNoticeUrl(url: URL) {
  const clean = new URL(url);
  const values: Record<string, string> = {};
  for (const key of noticeKeys(url.pathname)) {
    const value = clean.searchParams.get(key);
    if (value !== null) { values[key] = value.slice(0, 600); clean.searchParams.delete(key); }
  }
  if (Object.keys(values).length) clean.hash = "";
  return { clean, values };
}
