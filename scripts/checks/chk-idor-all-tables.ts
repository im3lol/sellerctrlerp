// Cross-tenant (IDOR) check over EVERY row-secured table, read-only, against real data.
// Connects as appuser (the app's NOBYPASSRLS role) and, for each pair of orgs, scopes to A
// the exact way withOrgScope does, then proves nothing of B is visible:
//   • tables with organization_id: no visible row has another org's id
//   • child tables (no organization_id, policy via parent): the id sets visible under A and
//     under B never overlap
// Plus: with no scope set, every table returns zero rows (fail-closed).
// Complements rls:leak (which seeds + tests WRITE checks on a few tables).
//
// Run:  APPUSER_DATABASE_URL=postgres://appuser:…@localhost:5433/sellerctrl \
//       npx tsx --tsconfig tsconfig.script.json scripts/checks/chk-idor-all-tables.ts

import { Pool, type PoolClient } from "pg";

const url = process.env.APPUSER_DATABASE_URL;
if (!url) { console.error("set APPUSER_DATABASE_URL (the appuser role)"); process.exit(2); }
const pool = new Pool({ connectionString: url });

async function scoped<T>(c: PoolClient, org: string | null, fn: () => Promise<T>): Promise<T> {
  await c.query("BEGIN");
  try {
    if (org) await c.query("select set_config('app.current_org', $1, true), set_config('app.is_platform_admin', 'off', true)", [org]);
    return await fn();
  } finally { await c.query("ROLLBACK"); }
}

async function main() {
  const c = await pool.connect();
  let fails = 0;
  const fail = (m: string) => { fails++; console.log(`  ✗ ${m}`); };
  try {
    const { rows: [role] } = await c.query("select current_user u, rolbypassrls b from pg_roles where rolname = current_user");
    if (role.b) { console.error(`✗ ${role.u} bypasses RLS — this check would prove nothing`); process.exit(2); }

    const { rows: tables } = await c.query<{ t: string; has_org: boolean; has_id: boolean }>(`
      select c.relname t,
        exists(select 1 from information_schema.columns where table_name = c.relname and column_name = 'organization_id') has_org,
        exists(select 1 from information_schema.columns where table_name = c.relname and column_name = 'id') has_id
      from pg_class c where c.relkind = 'r' and c.relnamespace = 'public'::regnamespace and c.relrowsecurity order by 1`);

    // The org list itself is policied; read it under platform scope.
    const orgs = await (async () => {
      await c.query("BEGIN");
      await c.query("select set_config('app.is_platform_admin', 'on', true)");
      const r = await c.query<{ id: string }>("select id from organizations order by created_at");
      await c.query("ROLLBACK");
      return r.rows.map((x) => x.id);
    })();
    console.log(`${tables.length} row-secured tables × ${orgs.length} orgs (as ${role.u})`);

    // Fail-closed: no scope → nothing.
    for (const { t } of tables) {
      const n = await scoped(c, null, async () => Number((await c.query(`select count(*) n from "${t}"`)).rows[0].n));
      if (n > 0) fail(`${t}: ${n} rows visible with NO org scope`);
    }

    for (const { t, has_org, has_id } of tables) {
      if (has_org) {
        for (const a of orgs) {
          const n = await scoped(c, a, async () => Number((await c.query(`select count(*) n from "${t}" where organization_id is distinct from $1`, [a])).rows[0].n));
          if (n > 0) fail(`${t}: scope ${a.slice(0, 8)} sees ${n} rows of other orgs`);
        }
      } else if (has_id) {
        const seen = new Map<string, string>();
        for (const a of orgs) {
          const ids = await scoped(c, a, async () => (await c.query(`select id::text id from "${t}"`)).rows.map((r) => r.id as string));
          for (const id of ids) {
            const prev = seen.get(id);
            if (prev && prev !== a) { fail(`${t}: row ${id} visible to ${prev.slice(0, 8)} AND ${a.slice(0, 8)}`); break; }
            seen.set(id, a);
          }
        }
      }
    }
  } finally { c.release(); await pool.end(); }
  console.log(fails === 0 ? "✅ no cross-tenant row visible on any table" : `❌ ${fails} leak(s)`);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
