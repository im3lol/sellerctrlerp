import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { authConfig } from "./auth.config";
import { verifyCredentials } from "@/lib/auth/verify-credentials";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        // Accepts an email OR a username (migrated ERP users have no email).
        email: { label: "البريد الإلكتروني أو اسم المستخدم", type: "text" },
        password: { label: "كلمة المرور", type: "password" },
        token: { label: "رمز المصادقة الثنائية", type: "text" },
      },
      async authorize(creds) {
        // Per-IP throttle. The per-account lockout (password-policy) stops brute force
        // against ONE account but does nothing against credential stuffing, where each
        // guess targets a different account and no counter ever fills.
        const { headers } = await import("next/headers");
        const { rateLimit, clientIp } = await import("@/lib/rate-limit");
        const ip = clientIp(await headers());
        if (!rateLimit(`login:${ip}`, 30, 10 * 60_000)) return null;

        const user = await verifyCredentials(
          String(creds?.email ?? ""),
          String(creds?.password ?? ""),
          creds?.token != null ? String(creds.token) : undefined,
        );
        if (!user) return null;
        return { id: user.id, name: user.name, email: user.email, role: user.role, image: user.avatarUrl ?? undefined };
      },
    }),
  ],
});
