/** Read-only check of the actual transaction/GUC contract. No test records or writes. */
import { sql } from "drizzle-orm";
import { db, pool } from "@/lib/db";
import { withOrgScope, withPlatformScope } from "@/lib/db-scope";

type Scope = { org: string; admin: string };
const current = async () => (await db.execute<Scope>(sql`select current_setting('app.current_org', true) org, current_setting('app.is_platform_admin', true) admin`)).rows[0];
const assert = (ok: boolean, label: string) => { if (!ok) throw new Error(label); console.log(`PASS ${label}`); };

async function main() {
  const orgs = await withPlatformScope(async () => {
    assert((await current()).admin === "on", "platform bootstrap");
    return (await db.execute<{ id: string }>(sql`select id from organizations order by id limit 2`)).rows;
  });
  if (orgs.length < 2) throw new Error("Two existing companies are required; no records were created");
  await withPlatformScope(async () => {
    await withOrgScope(orgs[0].id, false, async () => {
      const scope = await current();
      assert(scope.org === orgs[0].id && scope.admin === "off", "tenant scope does not inherit platform bypass");
      // Exercise the production non-bypass role even when the local operator's
      // connection is an owner. SET LOCAL ROLE ends with this read-only transaction.
      await db.execute(sql`set local role appuser`);
      const foreign = (await db.execute<{ n: number }>(sql`select count(*)::int n from items where organization_id <> ${orgs[0].id}`)).rows[0];
      assert(foreign.n === 0, "appuser RLS blocks foreign-company item reads");
      await withPlatformScope(async () => assert((await current()).admin === "off", "nested platform helper cannot elevate tenant"));
      let denied = false;
      try { await withOrgScope(orgs[1].id, false, async () => undefined); } catch { denied = true; }
      assert(denied, "nested tenant switch rejected");
    });
    assert((await current()).admin === "on", "platform parent restored");
  });
  const scopes = await Promise.all(orgs.map(o => withOrgScope(o.id, false, current)));
  assert(scopes.every((s, i) => s.org === orgs[i].id && s.admin === "off"), "concurrent company scopes isolated");
}
main().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => pool.end());
