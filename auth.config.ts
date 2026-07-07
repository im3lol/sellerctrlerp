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
  providers: [],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as { role?: string }).role;
        token.name = user.name;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as string;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
