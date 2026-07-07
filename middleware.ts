import NextAuth from "next-auth";
import { authConfig } from "./auth.config";

const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const { nextUrl } = req;
  const isLoggedIn = !!req.auth;
  const role = req.auth?.user?.role;
  const path = nextUrl.pathname;

  const isPublic =
    path === "/" ||
    path === "/platform/login" || // standalone owner login (own audience)
    path.startsWith("/login") ||
    path.startsWith("/api/auth") ||
    path.startsWith("/api/platform/desktop-license") || // token-authed phone-home (desktop app activation + heartbeat)
    path.startsWith("/api/admin/init-accounting") || // token-authed one-time tenant setup; route enforces INIT_SETUP_TOKEN
    path.startsWith("/_next") ||
    path.startsWith("/brand");

  // Unauthenticated → bounce to login (the owner console has its own login).
  if (!isLoggedIn && !isPublic) {
    const loginPath = path.startsWith("/platform") ? "/platform/login" : "/login";
    const url = new URL(loginPath, nextUrl);
    url.searchParams.set("callbackUrl", path);
    return Response.redirect(url);
  }

  // Platform console is owner-only — enforce at middleware so a future page
  // that forgets its own gate doesn't silently expose owner data.
  if (isLoggedIn && path.startsWith("/platform") && !isPublic && role !== "system_admin") {
    return Response.redirect(new URL("/dashboard", nextUrl));
  }

  if (isLoggedIn) {
    // Already-authed users on the landing or a login page → go to the app.
    if (path === "/" || path.startsWith("/login")) {
      return Response.redirect(new URL("/dashboard", nextUrl));
    }
  }

  return undefined;
});

export const config = {
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico|brand).*)"],
};
