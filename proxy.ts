import NextAuth from "next-auth";
import { authConfig } from "./auth.config";

/**
 * Proxy (formerly `middleware.ts`, renamed per Next 16). Runs on the nodejs
 * runtime. Gates the whole app behind Auth.js and redirects already-authed
 * users off the landing/login pages. A default export is a valid proxy handler.
 */
const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const { nextUrl } = req;
  const isLoggedIn = !!req.auth;
  const role = (req.auth?.user as { role?: string } | undefined)?.role;
  const path = nextUrl.pathname;

  const isPublic =
    path === "/" ||
    path.startsWith("/login") ||
    path.startsWith("/signup") ||
    path.startsWith("/privacy") || // public legal page

    path === "/api/health" || // liveness/readiness probe — no session, no tenant data
    path.startsWith("/api/auth") ||
    path.startsWith("/api/v1") || // public REST API — authed per-request by API key, not session
    path.startsWith("/api/cron") || // cron sidecar — authed by CRON_SECRET in the route, not session
    path.startsWith("/api/admin/init-accounting") || // token-authed one-time tenant setup; route enforces INIT_SETUP_TOKEN
    path.startsWith("/api/subscription/xpay") || // xpay gateway callback/return — verified server-side by transaction lookup, not session
    (path.startsWith("/api/erp/marketplace/") && path.endsWith("/callback")) || // OAuth return — verified by the signed state (+ provider HMAC), not the app session
    (path.startsWith("/api/erp/marketplace/") && path.endsWith("/webhook")) || // order webhooks (Noon ?key=, Woo X-WC-Webhook-Signature) — each route authenticates the caller itself, no app session
    path.startsWith("/_next") ||
    path.startsWith("/brand") ||
    path.startsWith("/sounds"); // static notification chimes — no auth needed

  // The admin panel is a fully separate surface: ONLY the platform owner
  // (system_admin) may enter. Anyone else — unauthenticated OR a signed-in tenant
  // user — is sent to the dedicated admin login, never into the tenant workspace.
  if (path === "/admin" || path.startsWith("/admin/")) {
    if (role !== "system_admin") {
      return Response.redirect(new URL("/login/admin", nextUrl));
    }
    return undefined;
  }

  // Unauthenticated → bounce to login, preserving the intended destination.
  if (!isLoggedIn && !isPublic) {
    const url = new URL("/login", nextUrl);
    url.searchParams.set("callbackUrl", path);
    return Response.redirect(url);
  }

  // Already-authed users on the landing or a login page → go to the app. The
  // admin login is special: a system_admin lands in /admin; a signed-in tenant
  // user stays on it so they can authenticate as an admin instead.
  if (isLoggedIn && (path === "/" || path.startsWith("/login") || path.startsWith("/signup"))) {
    if (path === "/login/admin") {
      return role === "system_admin" ? Response.redirect(new URL("/admin", nextUrl)) : undefined;
    }
    return Response.redirect(new URL("/dashboard", nextUrl));
  }

  return undefined;
});

export const config = {
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico|brand).*)"],
};
