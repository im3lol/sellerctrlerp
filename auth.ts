import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { eq, sql } from "drizzle-orm";
import { authConfig } from "./auth.config";
import { db } from "@/lib/db";
import { users } from "@/db/schema";
import { isErpLegacyHash, verifyErpPassword } from "@/lib/erp/password";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        // Accepts an email OR a username (migrated ERP users have no email).
        email: { label: "البريد الإلكتروني أو اسم المستخدم", type: "text" },
        password: { label: "كلمة المرور", type: "password" },
      },
      async authorize(creds) {
        const identifier = String(creds?.email ?? "").toLowerCase().trim();
        const password = String(creds?.password ?? "");
        if (!identifier || !password) return null;

        // Match by email first; then by (case-insensitive) username. The
        // username branch is wrapped so it degrades gracefully on a database
        // where the column has not been migrated yet.
        let [user] = await db.select().from(users).where(eq(users.email, identifier)).limit(1);
        if (!user) {
          try {
            [user] = await db
              .select()
              .from(users)
              .where(eq(sql`lower(${users.username})`, identifier))
              .limit(1);
          } catch {
            // username column not present — email-only login.
          }
        }
        if (!user || !user.isActive) return null;

        let ok = false;
        if (user.passwordHash.startsWith("$2")) {
          // Standard bcrypt hash.
          ok = await bcrypt.compare(password, user.passwordHash);
        } else if (isErpLegacyHash(user.passwordHash)) {
          // Migrated ERP user (scrypt or legacy base64): verify, then upgrade
          // the stored hash to bcrypt on first successful login.
          ok = await verifyErpPassword(password, user.passwordHash);
          if (ok) {
            const upgraded = await bcrypt.hash(password, 10);
            await db.update(users).set({ passwordHash: upgraded }).where(eq(users.id, user.id));
          }
        }
        if (!ok) return null;

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          image: user.avatarUrl ?? undefined,
        };
      },
    }),
  ],
});
