import { noticeKeys } from "./lib/ui-notice-policy";
import { noticeResponse } from "./lib/ui-notice-response";
import NextAuth from "next-auth";
import { authConfig } from "./auth.config";
import { loginDestination } from "./lib/auth/login-destination";

/**
 * Proxy (formerly `middleware.ts`, renamed per Next 16). Runs on the nodejs
 * runtime. Gates the whole app behind Auth.js and redirects already-authed
 * users off the landing/login pages. A default export is a valid proxy handler.
 */
const { auth } = NextAuth(authConfig);
const publicBrandMetadataPaths = new Set(["/favicon.ico", "/icon.png", "/apple-icon.png", "/manifest.webmanifest"]);
const publicMarketingPaths = new Set(["/", "/signup", "/privacy", "/privacy-policy", "/robots.txt", "/sitemap.xml"]);

export default auth((req) => {
  const { nextUrl } = req;
  const isLoggedIn = !!req.auth;
  const role = (req.auth?.user as { role?: string } | undefined)?.role;
  const path = nextUrl.pathname;
  const appOrigin = new URL(process.env.APP_URL ?? "https://app.sellerctrl.com");
  const requestHost = (req.headers?.get("x-forwarded-host") ?? req.headers?.get("host") ?? nextUrl.host).split(",")[0].trim().toLowerCase();
  if (process.env.STORAGE_PORTAL_URL && (path === "/storage" || path.startsWith("/storage/"))) {
    const portal = new URL(process.env.STORAGE_PORTAL_URL);
    if (requestHost !== portal.host) {
      return Response.redirect(new URL((path === "/storage" ? "/" : path) + nextUrl.search, portal), 302);
    }
  }

  // The tunnel serves multiple hostnames from one container. Consolidate only the
  // crawlable pages so canonical URLs, robots and the sitemap cannot split SEO equity.
  const marketingOrigin = new URL(process.env.MARKETING_URL ?? "https://sellerctrl.com");
  const isMarketingHost = requestHost === marketingOrigin.host || requestHost === `www.${marketingOrigin.hostname}`;
  // Login pages live on the primary domain; keep query strings (including
  // callbackUrl, OAuth continuations and expired-session notices) unchanged.
  if ((path === "/login" || path.startsWith("/login/")) && requestHost !== marketingOrigin.host && (req.method === "GET" || req.method === "HEAD")) {
    return Response.redirect(new URL(path + nextUrl.search, marketingOrigin), 302);
  }
  if (path === "/" && requestHost === appOrigin.host) return Response.redirect(new URL("/dashboard", appOrigin), 302);
  if (publicMarketingPaths.has(path) && requestHost !== marketingOrigin.host && (requestHost === appOrigin.host || requestHost === `www.${marketingOrigin.hostname}`)) {
    const redirectUrl = nextUrl.clone();
    redirectUrl.protocol = marketingOrigin.protocol;
    redirectUrl.host = marketingOrigin.host;
    return Response.redirect(redirectUrl, 308);
  }

  const isPublic =
    publicBrandMetadataPaths.has(path) ||
    path === "/" ||
    path.startsWith("/login") ||
    path.startsWith("/signup") ||
    path.startsWith("/privacy") || // public legal page
    path === "/robots.txt" || path === "/sitemap.xml" || // crawlers read these signed-out
    path.startsWith("/d/") || // customer document link — authorised by its signed, expiring token (lib/erp/doc-link.ts)

    path === "/api/health" || // liveness/readiness probe — no session, no tenant data
    path === "/mcp" || // MCP Bearer/OAuth authentication is enforced by the route
    path.startsWith("/api/mcp/oauth/") ||
    path === "/.well-known/oauth-authorization-server" ||
    path === "/.well-known/oauth-authorization-server/api/mcp/oauth" ||
    path === "/.well-known/oauth-protected-resource" ||
    path === "/.well-known/oauth-protected-resource/mcp" ||
    path.startsWith("/api/auth") ||
    path.startsWith("/api/v1") || // public REST API — authed per-request by API key, not session
    path.startsWith("/api/cron") || // cron sidecar — authed by CRON_SECRET in the route, not session
    path === "/api/telegram/webhook" || // Telegram bot — authed by the secret-token header in the route, not session
    path.startsWith("/api/admin/init-accounting") || // token-authed one-time tenant setup; route enforces INIT_SETUP_TOKEN
    path.startsWith("/api/subscription/xpay") || // xpay gateway callback/return — verified server-side by transaction lookup, not session
    (path.startsWith("/api/erp/marketplace/") && path.endsWith("/callback")) || // OAuth return — verified by the signed state (+ provider HMAC), not the app session
    (path.startsWith("/api/erp/marketplace/") && path.endsWith("/webhook")) || // order webhooks (Noon ?key=, Woo X-WC-Webhook-Signature) — each route authenticates the caller itself, no app session
    path.startsWith("/_next") ||
    path.startsWith("/brand") ||
    path.startsWith("/icons/") ||
    (path.startsWith("/academy/") && /\.(?:png|jpe?g|webp|svg|avif)$/i.test(path)) ||
    path.startsWith("/sounds"); // static notification chimes — no auth needed

  // Keep business screens on the app host; never redirect API calls or POST bodies.
  if (isMarketingHost && !isPublic && !path.startsWith("/api/") && (!req.method || req.method === "GET" || req.method === "HEAD")) {
    return Response.redirect(new URL(path + nextUrl.search, appOrigin), 302);
  }

  // The admin panel is a fully separate surface: ONLY the platform owner
  // (system_admin) may enter. Anyone else — unauthenticated OR a signed-in tenant
  // user — is sent to the dedicated admin login, never into the tenant workspace.
  if (path === "/admin" || path.startsWith("/admin/")) {
    if (role !== "system_admin") {
      return Response.redirect(new URL("/login/admin", marketingOrigin));
    }
  }

  // Unauthenticated → bounce to login, preserving the intended destination.
  if (!isLoggedIn && !isPublic) {
    const url = new URL("/login", marketingOrigin);
    url.searchParams.set("callbackUrl", path + nextUrl.search);
    return Response.redirect(url);
  }

  // Already-authed users on the landing or a login page → go to the app. The
  // admin login is special: a system_admin lands in /admin; a signed-in tenant
  // user stays on it so they can authenticate as an admin instead.
  if (isLoggedIn && ((path === "/" && !isMarketingHost) || path.startsWith("/login") || path.startsWith("/signup")) && !nextUrl.searchParams.has("expired")) {
    if (path === "/login/admin") {
      return role === "system_admin" ? Response.redirect(new URL(loginDestination(nextUrl.searchParams.get("callbackUrl"), "/admin"), appOrigin)) : undefined;
    }
    return Response.redirect(new URL(loginDestination(nextUrl.searchParams.get("callbackUrl"), "/dashboard"), appOrigin));
  }

  // Canonicalize legacy presentation flags without touching filters or OAuth callbacks.
  if ((req.method === "GET" || req.method === "HEAD") && noticeKeys(path).some(key => nextUrl.searchParams.has(key))) {
    const origin = path.startsWith("/storage") && process.env.STORAGE_PORTAL_URL ? new URL(process.env.STORAGE_PORTAL_URL) : appOrigin;
    return noticeResponse(new URL(path + nextUrl.search, origin), 302);
  }
  return undefined;
});

export const config = {
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico|brand).*)"],
};
