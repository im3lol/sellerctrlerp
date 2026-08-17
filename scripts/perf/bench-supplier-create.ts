/**
 * Stage-by-stage profile of "create a supplier", using the REAL functions the server
 * action calls — not a reimplementation. Measures where the milliseconds actually go.
 *
 *   DATABASE_URL=… npx tsx --tsconfig tsconfig.script.json scripts/perf/bench-supplier-create.ts [runs]
 *
 * Non-destructive: every supplier it creates carries a PERFBENCH- code and is deleted in
 * the finally block. Pass `--keep N` to leave N rows behind for a data-volume sweep.
 */
import { performance } from "node:perf_hooks";
import { and, asc, eq, like } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { db, realDb, pool } from "@/lib/db";
import { withOrgScope, withPlatformScope } from "@/lib/db-scope";
import { suppliers, organizations, organizationMembers, users, salesPlatforms } from "@/db/schema";
import { getMemberAccess } from "@/lib/erp/auth-guard";
import { getUserOrganizations } from "@/lib/erp/org";
import type { SessionUser } from "@/lib/session";

const BENCH = "PERFBENCH-";
const runs = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 5);

type Row = { stage: string; ms: number[] };
const rows: Row[] = [];
const rec = (stage: string, ms: number) => {
  const r = rows.find((x) => x.stage === stage) ?? (rows.push({ stage, ms: [] }), rows[rows.length - 1]);
  r.ms.push(ms);
};
async function time<T>(stage: string, fn: () => Promise<T>): Promise<T> {
  const t0 = performance.now();
  try { return await fn(); } finally { rec(stage, performance.now() - t0); }
}
const stats = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  return { n: s.length, min: s[0], med: s[Math.floor(s.length / 2)], max: s[s.length - 1], avg: s.reduce((p, c) => p + c, 0) / s.length };
};
const f = (n: number) => n.toFixed(1).padStart(7);

async function main() {
  // ---- fixtures: a real org + a real non-admin member, so RLS + role lookup are real.
  const [org] = await withPlatformScope(() => db.select({ id: organizations.id, nameAr: organizations.nameAr }).from(organizations).orderBy(asc(organizations.createdAt)).limit(1));
  if (!org) throw new Error("no organization");
  const [mem] = await withPlatformScope(() => db
    .select({ userId: organizationMembers.userId, role: organizationMembers.role })
    .from(organizationMembers).where(and(eq(organizationMembers.organizationId, org.id), eq(organizationMembers.isActive, true))).limit(1));
  if (!mem) throw new Error("no active member");
  const [u] = await withPlatformScope(() => db.select().from(users).where(eq(users.id, mem.userId)).limit(1));
  const user: SessionUser = { id: u.id, name: u.name, email: u.email, role: u.role, avatarUrl: u.avatarUrl, title: u.title, tourDismissed: u.tourDismissed };
  console.log(`org=${org.nameAr}  user=${user.email}  role=${user.role}  runs=${runs}\n`);

  // ---- baselines: what the floor looks like before any app code.
  for (let i = 0; i < runs; i++) {
    await time("0a. pool.connect() acquire", async () => { const c = await pool.connect(); c.release(); });
    await time("0b. SELECT 1 round-trip", async () => { await realDb.execute(sql`select 1`); });
    await time("0c. empty tx (BEGIN+COMMIT)", async () => { await realDb.transaction(async () => {}); });
    await time("0d. tx + set_config (withOrgScope shell)", async () => { await withOrgScope(org.id, false, async () => {}); });
  }

  try {
    for (let i = 0; i < runs; i++) {
      const label = `${BENCH}${Date.now()}-${i}`;

      // ---- authorizeErp(), minus the cookie/JWT step (needs a request; measured separately).
      await time("1. getUserOrganizations (platform scope tx)", () => getUserOrganizations(user));
      await time("2. getMemberAccess (org scope tx)", () => getMemberAccess(org.id, user));

      // ---- the action body: withOrgScope → auto-code → INSERT → commit.
      await time("3. action body TOTAL (scope+code+insert+commit)", () =>
        withOrgScope(org.id, false, async () => {
          await time("3a. nextSupplierCode (SELECT all SUP- codes)", async () => {
            const r = await db.select({ code: suppliers.code }).from(suppliers)
              .where(and(eq(suppliers.organizationId, org.id), like(suppliers.code, "SUP-%")));
            return r.length;
          });
          await time("3b. INSERT", async () => {
            await db.insert(suppliers).values({ organizationId: org.id, code: label, nameAr: `bench ${i}`, paymentTerms: 30 });
          });
        }));

      // ---- what re-renders after revalidatePath: the page query + the layout's nav queries.
      await time("4. page query: supplier list", () =>
        withOrgScope(org.id, false, () => db.select({ id: suppliers.id, code: suppliers.code, nameAr: suppliers.nameAr, phone: suppliers.phone, balance: suppliers.balance, paymentTerms: suppliers.paymentTerms })
          .from(suppliers).where(eq(suppliers.organizationId, org.id)).orderBy(asc(suppliers.code))));
      await time("5. layout: 3 nav queries (as the layout runs them)", async () => {
        await getUserOrganizations(user);
        await getMemberAccess(org.id, user);
        await withOrgScope(org.id, false, () => db.select({ id: salesPlatforms.id, name: salesPlatforms.name, code: salesPlatforms.code })
          .from(salesPlatforms).where(and(eq(salesPlatforms.organizationId, org.id), eq(salesPlatforms.isActive, true))).orderBy(asc(salesPlatforms.name)));
      });
    }
  } finally {
    const gone = await withPlatformScope(() => db.delete(suppliers).where(like(suppliers.code, `${BENCH}%`)).returning({ id: suppliers.id }));
    console.log(`cleanup: removed ${gone.length} bench rows\n`);
  }

  console.log("stage                                              n     min     med     avg     max   (ms)");
  console.log("".padEnd(92, "-"));
  for (const r of rows) {
    const s = stats(r.ms);
    console.log(`${r.stage.padEnd(48)} ${String(s.n).padStart(3)} ${f(s.min)} ${f(s.med)} ${f(s.avg)} ${f(s.max)}`);
  }
  await pool.end();
}

main().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
