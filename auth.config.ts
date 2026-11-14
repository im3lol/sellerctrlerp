import type { NextAuthConfig } from "next-auth";

/**
 * Auth.js config with no DB / bcrypt imports (nodejs-safe for proxy.ts).
 * Used by proxy.ts. The full config (auth.ts) extends this with the
 * Credentials provider whose authorize() touches Postgres.
 */
export const authConfig = {
  pages: {
    signIn: "/login",
  },
  session: { strategy: "jwt" },
  trustHost: true,
  // A shared, secure session lets the marketing login continue onto the app host.
  // A new cookie name avoids ambiguity with older host-only sessions.
  ...(process.env.AUTH_COOKIE_DOMAIN ? {
    cookies: {
      sessionToken: {
        name: "__Secure-sellerctrl.session-token",
        options: { httpOnly: true, sameSite: "lax" as const, path: "/", secure: true, domain: process.env.AUTH_COOKIE_DOMAIN },
      },
    },
  } : {}),
  providers: [],
  callbacks: {
    redirect({ url, baseUrl }) {
      const appOrigin = new URL(process.env.APP_URL ?? baseUrl).origin;
      const marketingOrigin = new URL(process.env.MARKETING_URL ?? baseUrl).origin;
      try {
        const destination = new URL(url, baseUrl);
        if ([new URL(baseUrl).origin, appOrigin, marketingOrigin].includes(destination.origin)) return destination.href;
      } catch { /* reject malformed destinations */ }
      return new URL("/dashboard", appOrigin).href;
    },
    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as { role?: string }).role;
        token.name = user.name;
        token.sv = (user as { sv?: number }).sv ?? 0; // session version at sign-in (lib/session.ts)
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as string;
        (session.user as { sv?: number }).sv = (token.sv as number | undefined) ?? 0;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
