import NextAuth from "next-auth";
import { authConfig } from "./auth.config";

const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const { nextUrl } = req;
  const isLoggedIn = !!req.auth;
  const path = nextUrl.pathname;

  const isPublic =
    path === "/" ||
    path.startsWith("/login") ||
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
  if (isLoggedIn && (path === "/" || path.startsWith("/login"))) {
    return Response.redirect(new URL("/dashboard", nextUrl));
  }

  return undefined;
});

export const config = {
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico|brand).*)"],
};
