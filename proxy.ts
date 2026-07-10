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
  const path = nextUrl.pathname;

  const isPublic =
    path === "/" ||
    path.startsWith("/login") ||
    path.startsWith("/signup") ||
    path.startsWith("/api/auth") ||
    path.startsWith("/api/admin/init-accounting") || // token-authed one-time tenant setup; route enforces INIT_SETUP_TOKEN
    path.startsWith("/_next") ||
    path.startsWith("/brand");

  // Unauthenticated → bounce to login, preserving the intended destination.
  if (!isLoggedIn && !isPublic) {
    const url = new URL("/login", nextUrl);
    url.searchParams.set("callbackUrl", path);
    return Response.redirect(url);
  }

  // Already-authed users on the landing or a login page → go to the app.
  if (isLoggedIn && (path === "/" || path.startsWith("/login") || path.startsWith("/signup"))) {
    return Response.redirect(new URL("/dashboard", nextUrl));
  }

  return undefined;
});

export const config = {
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico|brand).*)"],
};
