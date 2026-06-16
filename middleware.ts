import NextAuth from "next-auth";
import { authConfig } from "./auth.config";

const { auth } = NextAuth(authConfig);

const PUBLIC_PATHS = ["/", "/login", "/register"];

export default auth((req) => {
  const { nextUrl } = req;
  const isLoggedIn = !!req.auth;
  const role = req.auth?.user?.role;
  const path = nextUrl.pathname;

  const isPublic =
    PUBLIC_PATHS.includes(path) ||
    path.startsWith("/api/auth") ||
    path.startsWith("/_next") ||
    path.startsWith("/brand");

  // Unauthenticated → bounce to login (preserve intended destination).
  if (!isLoggedIn && !isPublic) {
    const url = new URL("/login", nextUrl);
    url.searchParams.set("callbackUrl", path);
    return Response.redirect(url);
  }

  if (isLoggedIn) {
    const isClient = role === "client";
    const onPortal = path.startsWith("/portal");

    // Clients are confined to the portal.
    if (isClient && !onPortal && !isPublic) {
      return Response.redirect(new URL("/portal", nextUrl));
    }
    // Staff hitting the portal get sent to their dashboard.
    if (!isClient && onPortal) {
      return Response.redirect(new URL("/dashboard", nextUrl));
    }
    // Already-authed users on auth pages → dashboard/portal.
    if (path === "/login" || path === "/register") {
      return Response.redirect(new URL(isClient ? "/portal" : "/dashboard", nextUrl));
    }
  }

  return undefined;
});

export const config = {
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico|brand).*)"],
};
