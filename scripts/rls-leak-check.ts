/**
 * RLS leak test — the go/no-go gate for enabling tenant isolation.
 *
 * Seeds two orgs (A, B) as the owner, then connects AS appuser (the role the app uses,
 * NOBYPASSRLS) and proves, through the exact `set_config('app.current_org', …, true)`
 * contract that withOrgScope uses, that:
 *   1. read isolation — scope A never returns a B row
 *   2. WITH CHECK   — you can't write a row into another org
 *   3. missing filter is now DB-blocked — a query with no org WHERE still sees only A
 *   4. no scope     — fail-closed, zero rows (not everything)
 *   5. platform     — the is_platform_admin bypass sees both orgs
 *
 * Run against the local Docker DB (app connects as the owner; this connects as appuser):
 *   npx tsx scripts/rls-leak-check.ts
 */
import { Pool } from "pg";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db"; // owner connection — seeds/cleans, bypasses RLS
import { organizations, customers, items, materialRequests, materialRequestLines, users, organizationMembers } from "@/db/schema";

const APPUSER_URL = process.env.APPUSER_DATABASE_URL ?? "postgres://appuser:appuser@localhost:5433/sellerctrl";

let failures = 0;
const check = (name: string, ok: boolean, extra = "") => {
  console.log(`  ${ok ? "✓" : "✗ FAIL"}  ${name}${extra ? ` — ${extra}` : ""}`);
  if (!ok) failures++;
};

async function main() {
  // ── seed as owner (RLS bypassed) ──
  const [orgA] = await db.insert(organizations).values({ nameAr: "شركة أ", nameEn: "Org A", slug: `rls-a-${Date.now()}` }).returning({ id: organizations.id });
  const [orgB] = await db.insert(organizations).values({ nameAr: "شركة ب", nameEn: "Org B", slug: `rls-b-${Date.now()}` }).returning({ id: organizations.id });
  await db.insert(customers).values([
    { organizationId: orgA.id, code: "CA1", nameAr: "عميل أ" },
    { organizationId: orgB.id, code: "CB1", nameAr: "عميل ب" },
  ]);

  // A line table + its parent chain per org, to prove denormalized-org isolation.
  // organizationId on the line is OMITTED — the set_org trigger derives it from
  // the parent (that's the whole mechanism; passing it would hide a trigger bug).
  const [itemA] = await db.insert(items).values({ organizationId: orgA.id, code: "IA1", nameAr: "صنف أ" }).returning({ id: items.id });
  const [itemB] = await db.insert(items).values({ organizationId: orgB.id, code: "IB1", nameAr: "صنف ب" }).returning({ id: items.id });
  const [mrA] = await db.insert(materialRequests).values({ organizationId: orgA.id, number: "MRA1", date: new Date() }).returning({ id: materialRequests.id });
  const [mrB] = await db.insert(materialRequests).values({ organizationId: orgB.id, number: "MRB1", date: new Date() }).returning({ id: materialRequests.id });
  await db.insert(materialRequestLines).values([
    { materialRequestId: mrA.id, itemId: itemA.id, quantity: "1" },
    { materialRequestId: mrB.id, itemId: itemB.id, quantity: "1" },
  ]);

  // A user who is a member of BOTH orgs — to exercise the auth-bootstrap reads
  // (getUserOrganizations / getMemberAccess) that run BEFORE a tenant scope exists.
  const [usr] = await db.insert(users).values({ name: "RLS Boot", email: `rls-boot-${Date.now()}@t.test`, passwordHash: "x" }).returning({ id: users.id });
  await db.insert(organizationMembers).values([
    { organizationId: orgA.id, userId: usr.id, role: "owner" },
    { organizationId: orgB.id, userId: usr.id, role: "owner" },
  ]);

  const app = new Pool({ connectionString: APPUSER_URL });
  try {
    // The whole point: if this isn't appuser, RLS is bypassed and the test is a lie.
    const who = (await app.query("select current_user as u")).rows[0].u;
    check("connected as appuser (not owner/superuser)", who === "appuser", who);

    // helper: run queries inside a scope that sets app.current_org like withOrgScope does
    const inScope = async (org: string | null, admin: boolean, run: (c: import("pg").PoolClient) => Promise<void>) => {
      const c = await app.connect();
      try {
        await c.query("begin");
        await c.query("select set_config('app.current_org', $1, true), set_config('app.is_platform_admin', $2, true)", [org ?? "", admin ? "on" : "off"]);
        await run(c);
        await c.query("commit");
      } catch (e) { await c.query("rollback"); throw e; } finally { c.release(); }
    };

    // 1. read isolation
    await inScope(orgA.id, false, async (c) => {
      const rows = (await c.query("select organization_id from customers")).rows;
      check("scope A: sees A's customers, none of B's",
        rows.length === 1 && rows.every((r) => r.organization_id === orgA.id), `${rows.length} rows`);
    });

    // 3. missing-filter now DB-blocked (no WHERE at all)
    await inScope(orgB.id, false, async (c) => {
      const rows = (await c.query("select organization_id from customers")).rows; // deliberately no org filter
      check("scope B: a filter-less query still returns ONLY B (missing-filter blocked)",
        rows.length === 1 && rows[0].organization_id === orgB.id, `${rows.length} rows`);
    });

    // 2. WITH CHECK — can't insert into another org, can't move a row across orgs
    await inScope(orgA.id, false, async (c) => {
      let threw = false;
      try { await c.query("insert into customers (organization_id, code, name_ar) values ($1,'X','x')", [orgB.id]); }
      catch { threw = true; }
      check("scope A: inserting a row tagged org B is blocked (WITH CHECK)", threw);
    });
    await inScope(orgA.id, false, async (c) => {
      let threw = false;
      // Postgres raises on the WITH CHECK violation rather than updating 0 rows —
      // stronger than a silent no-op. Run in its own savepoint so the error doesn't
      // abort the surrounding transaction.
      await c.query("savepoint s");
      try { await c.query("update customers set organization_id=$1 where code='CA1'", [orgB.id]); }
      catch { threw = true; await c.query("rollback to savepoint s"); }
      check("scope A: moving A's row to org B is blocked (WITH CHECK)", threw);
    });

    // 4. no scope → fail-closed
    check("no scope: fail-closed (0 rows, not everything)",
      (await app.query("select id from customers")).rowCount === 0);

    // 5. platform scope → both orgs
    await inScope(null, true, async (c) => {
      const rows = (await c.query("select organization_id from customers where organization_id = any($1)", [[orgA.id, orgB.id]])).rows;
      check("platform scope: sees BOTH orgs (admin/cron bypass)", rows.length === 2);
    });

    // 6. line table: denormalized-org read isolation (filter-less query still only A)
    await inScope(orgA.id, false, async (c) => {
      const rows = (await c.query("select organization_id from material_request_lines")).rows;
      check("line table: scope A sees only A's lines (denormalized org isolation)",
        rows.length === 1 && rows[0].organization_id === orgA.id, `${rows.length} rows`);
    });

    // 7. line table INSERT: org omitted, the set_org trigger fills it from the parent
    await inScope(orgA.id, false, async (c) => {
      await c.query("insert into material_request_lines (material_request_id, item_id, quantity) values ($1,$2,'1')", [mrA.id, itemA.id]);
      const rows = (await c.query("select organization_id from material_request_lines")).rows;
      check("line table: INSERT onto A's parent fills org=A via trigger (no call-site org)",
        rows.length === 2 && rows.every((r) => r.organization_id === orgA.id));
    });

    // 8. line table cross-org INSERT: pointing a line at org B's parent while in scope A
    //    is blocked — the trigger's parent lookup can't see B's row → NULL → NOT NULL.
    await inScope(orgA.id, false, async (c) => {
      let threw = false;
      await c.query("savepoint s");
      try { await c.query("insert into material_request_lines (material_request_id, item_id, quantity) values ($1,$2,'1')", [mrB.id, itemA.id]); }
      catch { threw = true; await c.query("rollback to savepoint s"); }
      check("line table: INSERT onto org B's parent (scope A) is blocked", threw);
    });

    // ── AUTH BOOTSTRAP: the reads that resolve identity/org run BEFORE a scope ──
    // These lock in the fix: getUserOrganizations must run in platform scope;
    // getMemberAccess/getErpRole must run in the target-org scope.
    // 9. WITHOUT a scope, the membership read returns 0 → this is exactly why the
    //    guard would deny everyone if it ran unscoped (the pre-fix bug).
    check("bootstrap: membership read with NO scope returns 0 (why the fix is needed)",
      (await app.query("select 1 from organization_members where user_id=$1", [usr.id])).rowCount === 0);

    // 10. getMemberAccess pattern: scope A sees the user's A-membership (grants access).
    await inScope(orgA.id, false, async (c) => {
      const rows = (await c.query("select organization_id from organization_members where user_id=$1", [usr.id])).rows;
      check("bootstrap: getMemberAccess under withOrgScope(A) sees the A membership",
        rows.length === 1 && rows[0].organization_id === orgA.id);
    });

    // 11. getUserOrganizations pattern: platform scope lists BOTH memberships.
    await inScope(null, true, async (c) => {
      const rows = (await c.query("select organization_id from organization_members where user_id=$1", [usr.id])).rows;
      check("bootstrap: getUserOrganizations under withPlatformScope lists BOTH orgs", rows.length === 2);
    });

    // 12. authorizeErp now runs getMemberAccess inside the SAME platform scope as
    // getUserOrganizations (one transaction instead of two), so RLS is bypassed for that
    // read and the explicit (organization_id, user_id) filter is the only control left.
    // These two pin that control down.
    await inScope(null, true, async (c) => {
      const rows = (await c.query(
        "select organization_id, role from organization_members where organization_id=$1 and user_id=$2",
        [orgB.id, usr.id])).rows;
      check("bootstrap: getMemberAccess under withPlatformScope returns ONLY the queried org",
        rows.length === 1 && rows[0].organization_id === orgB.id, JSON.stringify(rows));

      const stranger = (await c.query(
        "select 1 from organization_members where organization_id=$1 and user_id=$2",
        [orgA.id, "00000000-0000-0000-0000-000000000000"])).rowCount;
      check("bootstrap: a non-member gets no row even with RLS bypassed", stranger === 0, String(stranger));
    });
  } finally {
    await app.end();
    await db.delete(customers).where(eq(customers.organizationId, orgA.id));
    await db.delete(customers).where(eq(customers.organizationId, orgB.id));
    await db.delete(organizations).where(eq(organizations.id, orgA.id)); // cascades memberships
    await db.delete(organizations).where(eq(organizations.id, orgB.id));
    await db.delete(users).where(eq(users.id, usr.id));
  }

  console.log(failures === 0 ? "\n✅ RLS leak test PASSED" : `\n❌ ${failures} check(s) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
