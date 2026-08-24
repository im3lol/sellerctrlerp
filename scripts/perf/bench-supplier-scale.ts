/**
 * Two questions the stage profile leaves open:
 *   1. Does creating a supplier get slower as the table grows? (nextSupplierCode reads
 *      every SUP- code into JS on every insert — O(rows) by construction.)
 *   2. What does the post-mutation re-render actually cost, with the layout's nav
 *      queries running in parallel the way the layout runs them?
 *
 *   DATABASE_URL=… npx tsx --tsconfig tsconfig.script.json scripts/perf/bench-supplier-scale.ts
 *
 * Non-destructive: everything it creates carries a PERFBENCH- code and is deleted in the
 * finally block.
 */
import { performance } from "node:perf_hooks";
import { and, asc, eq, like, sql } from "drizzle-orm";
import { db, realDb, pool } from "@/lib/db";
import { withOrgScope, withPlatformScope } from "@/lib/db-scope";
import { suppliers, organizations, organizationMembers, users, salesPlatforms } from "@/db/schema";
import { getMemberAccess } from "@/lib/erp/auth-guard";
import { getUserOrganizations } from "@/lib/erp/org";
import type { SessionUser } from "@/lib/session";

const BENCH = "PERFBENCH-";
const med = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const f = (n: number) => n.toFixed(1).padStart(7);

async function main() {
  const [org] = await withPlatformScope(() => db.select({ id: organizations.id }).from(organizations).orderBy(asc(organizations.createdAt)).limit(1));
  const [mem] = await withPlatformScope(() => db.select({ userId: organizationMembers.userId }).from(organizationMembers)
    .where(and(eq(organizationMembers.organizationId, org.id), eq(organizationMembers.isActive, true))).limit(1));
  const [u] = await withPlatformScope(() => db.select().from(users).where(eq(users.id, mem.userId)).limit(1));
  const user: SessionUser = { id: u.id, name: u.name, email: u.email, role: u.role, avatarUrl: u.avatarUrl, title: u.title, tourDismissed: u.tourDismissed };

  try {
    // ---- 1. does it scale? seed to N, then time one more create at that size.
    console.log("A. create-one latency vs table size (median of 5, ms)\n");
    console.log("  rows   nextSupplierCode   INSERT   action body   list query");
    let seeded = 0, probe = 0;
    for (const target of [1, 5, 20, 100, 500]) {
      await withOrgScope(org.id, false, async () => {
        const rowsToAdd = target - seeded;
        if (rowsToAdd > 0) {
          await db.insert(suppliers).values(Array.from({ length: rowsToAdd }, (_, i) => ({
            organizationId: org.id, code: `SUP-${String(9000 + seeded + i).padStart(4, "0")}`,
            nameAr: `${BENCH}${seeded + i}`, paymentTerms: 30,
          })));
          seeded = target;
        }
      });

      const code: number[] = [], ins: number[] = [], body: number[] = [], list: number[] = [];
      for (let i = 0; i < 5; i++) {
        probe += 1;
        const t0 = performance.now();
        await withOrgScope(org.id, false, async () => {
          const t1 = performance.now();
          const all = await db.select({ code: suppliers.code }).from(suppliers)
            .where(and(eq(suppliers.organizationId, org.id), like(suppliers.code, "SUP-%")));
          let max = 0;
          for (const r of all) { const m = /^SUP-(\d+)$/.exec(r.code); if (m) max = Math.max(max, Number(m[1])); }
          void max; // the scan+max IS the measurement; the code we insert must not collide
          code.push(performance.now() - t1);
          const t2 = performance.now();
          await db.insert(suppliers).values({ organizationId: org.id, code: `SUP-${20000 + probe}`, nameAr: `${BENCH}probe${probe}`, paymentTerms: 30 });
          ins.push(performance.now() - t2);
        });
        body.push(performance.now() - t0);
        const t3 = performance.now();
        await withOrgScope(org.id, false, () => db.select({ id: suppliers.id, code: suppliers.code, nameAr: suppliers.nameAr, phone: suppliers.phone, balance: suppliers.balance, paymentTerms: suppliers.paymentTerms })
          .from(suppliers).where(eq(suppliers.organizationId, org.id)).orderBy(asc(suppliers.code)));
        list.push(performance.now() - t3);
      }
      const [{ c }] = await withOrgScope(org.id, false, () => db.execute<{ c: string }>(sql`select count(*)::text c from suppliers where organization_id = ${org.id}`).then((r) => r.rows));
      console.log(`  ${String(c).padStart(5)} ${f(med(code))}          ${f(med(ins))} ${f(med(body))}      ${f(med(list))}`);
    }

    // ---- 2. the post-mutation re-render, layout queries in parallel (as the layout does).
    console.log("\nB. what a post-mutation re-render costs (median of 8, ms)\n");
    const seq: number[] = [], par: number[] = [], whole: number[] = [];
    for (let i = 0; i < 8; i++) {
      const t0 = performance.now();
      await getUserOrganizations(user); await getMemberAccess(org.id, user);
      await withOrgScope(org.id, false, () => db.select({ id: salesPlatforms.id }).from(salesPlatforms).where(eq(salesPlatforms.organizationId, org.id)));
      seq.push(performance.now() - t0);

      const t1 = performance.now();
      await Promise.all([
        getUserOrganizations(user),
        getMemberAccess(org.id, user),
        withOrgScope(org.id, false, () => db.select({ id: salesPlatforms.id }).from(salesPlatforms).where(eq(salesPlatforms.organizationId, org.id))),
      ]);
      par.push(performance.now() - t1);

      const t2 = performance.now();
      await Promise.all([
        getUserOrganizations(user),
        getMemberAccess(org.id, user),
        withOrgScope(org.id, false, () => db.select({ id: salesPlatforms.id }).from(salesPlatforms).where(eq(salesPlatforms.organizationId, org.id))),
      ]);
      await withOrgScope(org.id, false, () => db.select({ id: suppliers.id, code: suppliers.code, balance: suppliers.balance })
        .from(suppliers).where(eq(suppliers.organizationId, org.id)).orderBy(asc(suppliers.code)));
      whole.push(performance.now() - t2);
    }
    console.log(`  layout nav, sequential          ${f(med(seq))}`);
    console.log(`  layout nav, Promise.all         ${f(med(par))}`);
    console.log(`  layout + suppliers page query   ${f(med(whole))}   <- server work per re-render`);

    // ---- 3. the per-transaction tax the scope wrapper pays.
    console.log("\nC. transaction overhead (median of 20, ms)\n");
    const q: number[] = [], t: number[] = [], s: number[] = [];
    for (let i = 0; i < 20; i++) {
      let t0 = performance.now(); await realDb.execute(sql`select 1`); q.push(performance.now() - t0);
      t0 = performance.now(); await realDb.transaction(async () => {}); t.push(performance.now() - t0);
      t0 = performance.now(); await withOrgScope(org.id, false, async () => {}); s.push(performance.now() - t0);
    }
    console.log(`  bare query (no tx)              ${f(med(q))}`);
    console.log(`  BEGIN + COMMIT                  ${f(med(t))}`);
    console.log(`  withOrgScope shell (+set_config)${f(med(s))}   <- paid once per scope entered`);
  } finally {
    const gone = await withPlatformScope(() => db.delete(suppliers).where(like(suppliers.nameAr, `${BENCH}%`)).returning({ id: suppliers.id }));
    console.log(`\ncleanup: removed ${gone.length} bench rows`);
  }
  await pool.end();
}

main().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
