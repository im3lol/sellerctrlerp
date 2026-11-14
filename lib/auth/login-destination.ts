/** Only local application destinations are accepted; never turn login into an open redirect. */
export function loginDestination(value: unknown, fallback = "/apps"): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u0020\u007f]/.test(value)) return fallback;
  try {
    const url = new URL(value, "https://login.invalid");
    if (url.origin !== "https://login.invalid" || /^\/(login|signup)(\/|$)/.test(url.pathname)) return fallback;
    return url.pathname + url.search + url.hash;
  } catch { return fallback; }
}

/** Credentials entered on the marketing host finish on the application host. */
export function applicationLoginDestination(value: unknown, fallback = "/dashboard"): string {
  const path = loginDestination(value, fallback);
  return process.env.NODE_ENV === "production" && process.env.APP_URL
    ? new URL(path, process.env.APP_URL).href
    : path;
}
