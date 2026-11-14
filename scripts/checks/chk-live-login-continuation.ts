/** Read-only redirect regression check. No OAuth grant, login or business data is created. */
import { encode } from "next-auth/jwt";
import { and, eq } from "drizzle-orm";
import { db, pool } from "@/lib/db";
import { users } from "@/db/schema";

async function main() {
  const origin = process.env.LIVE_CHECK_ORIGIN ?? "http://127.0.0.1:3001";
  const [user] = await db.select({ id: users.id, role: users.role, name: users.name, sv: users.sessionVersion })
    .from(users).where(and(eq(users.role, "system_admin"), eq(users.isActive, true))).limit(1);
  if (!user || !process.env.AUTH_SECRET) throw new Error("Active admin and configured session secret required");
  const cookies = await Promise.all(["authjs.session-token", "__Secure-authjs.session-token"].map(async salt => {
    const token = await encode({ secret: process.env.AUTH_SECRET!, salt, maxAge: 60,
      token: { sub: user.id, id: user.id, role: user.role, name: user.name, sv: user.sv } });
    return `${salt}=${token}`;
  }));
  const destination = "/mcp/authorize?client_id=redirect-regression&state=preserved&redirect_uri=http%3A%2F%2F127.0.0.1%3A3000%2Fcallback&scope=erp.identity";
  async function probe(path: string, signedIn: boolean) {
    return fetch(origin + path, { redirect: "manual", headers: signedIn ? { Cookie: cookies.join("; ") } : {}, signal: AbortSignal.timeout(20000) });
  }
  for (const path of ["/login", "/login/admin"]) {
    const response = await probe(`${path}?callbackUrl=${encodeURIComponent(destination)}`, true);
    const location = response.headers.get("location");
    if (!location || new URL(location, origin).pathname + new URL(location, origin).search !== destination) throw new Error(`${path} lost the OAuth continuation`);
    console.log(`PASS signed-in ${path} resumes the full OAuth request`);
    await response.body?.cancel();
  }
  const anonymous = await probe(destination, false);
  const target = new URL(anonymous.headers.get("location")!, origin);
  if (target.pathname !== "/login" || target.searchParams.get("callbackUrl") !== destination) throw new Error("Anonymous continuation lost");
  await anonymous.body?.cancel();
  console.log("PASS anonymous login preserves OAuth parameters");
  const unsafe = await probe("/login?callbackUrl=https%3A%2F%2Fevil.example", true);
  if (new URL(unsafe.headers.get("location")!, origin).pathname !== "/apps") throw new Error("Unsafe continuation accepted");
  await unsafe.body?.cancel();
  console.log("PASS external login redirects rejected");
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Redirect smoke failed"); process.exitCode = 1; }).finally(() => pool.end());
