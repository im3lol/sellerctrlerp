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
    path.startsWith("/login") || // /login, /login/admin, /login/client
    path.startsWith("/api/auth") ||
    path.startsWith("/api/scrape") || // token-authed (Edge extension + Docker worker); routes enforce auth
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
    const isClient = role === "client";
    const onPortal = path.startsWith("/portal");
    const dest = isClient ? "/portal" : "/dashboard";

    // Landing page → skip marketing, go straight to their area.
    if (path === "/") {
      return Response.redirect(new URL(dest, nextUrl));
    }

    // Clients are confined to the portal.
    if (isClient && !onPortal && !isPublic) {
      return Response.redirect(new URL("/portal", nextUrl));
    }
    // Staff hitting the portal get sent to their dashboard.
    if (!isClient && onPortal) {
      return Response.redirect(new URL("/dashboard", nextUrl));
    }
    // Already-authed users on a login page → send them to their area ONLY when
    // their role matches that page's audience (remember them). If a different
    // audience's login is opened (e.g. an admin visiting the partner login),
    // show the form so they can sign in with the right account instead of being
    // bounced into the wrong dashboard.
    if (path.startsWith("/login")) {
      const isPartnerPage = path.startsWith("/login/partner") || path.startsWith("/login/client");
      const matchesAudience = isPartnerPage ? isClient : !isClient;
      if (matchesAudience) {
        return Response.redirect(new URL(dest, nextUrl));
      }
    }
  }

  return undefined;
});

export const config = {
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico|brand).*)"],
};
