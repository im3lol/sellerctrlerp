/**
 * Staging smoke for the audit-remediation migrations, run AS appuser (the RLS
 * runtime role, NOBYPASSRLS) so it proves the columns behave under real isolation:
 *   0052  users.failed_login_attempts / locked_until   (login lockout — GLOBAL table)
 *   0053  api_keys.scope / expires_at                   (API-key scope+expiry — org-policied)
 *   0054  sales_invoices.sales_order_id                 (invoice→order link — org-policied)
 *
 * Seeds two orgs as the owner, then through the exact set_config('app.current_org',…)
 * contract withOrgScope uses, checks: columns exist + defaults right, appuser can
 * read/write them, and the new columns don't leak across the tenant boundary.
 *
 *   npx tsx scripts/smoke-new-migrations.ts
 */
import { Pool } from "pg";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db"; // owner connection — seeds/cleans, bypasses RLS
import { organizations, customers, users, apiKeys, salesOrders, salesInvoices } from "@/db/schema";

const APPUSER_URL = process.env.APPUSER_DATABASE_URL ?? "postgres://appuser:appuser@localhost:5433/sellerctrl";

let failures = 0;
const check = (name: string, ok: boolean, extra = "") => {
  console.log(`  ${ok ? "✓" : "✗ FAIL"}  ${name}${extra ? ` — ${extra}` : ""}`);
  if (!ok) failures++;
};

async function main() {
  const tag = Date.now();
  const [orgA] = await db.insert(organizations).values({ nameAr: "شركة أ", nameEn: "A", slug: `mig-a-${tag}` }).returning({ id: organizations.id });
  const [orgB] = await db.insert(organizations).values({ nameAr: "شركة ب", nameEn: "B", slug: `mig-b-${tag}` }).returning({ id: organizations.id });
  const [custA] = await db.insert(customers).values({ organizationId: orgA.id, code: `CA-${tag}`, nameAr: "عميل أ" }).returning({ id: customers.id });
  const [custB] = await db.insert(customers).values({ organizationId: orgB.id, code: `CB-${tag}`, nameAr: "عميل ب" }).returning({ id: customers.id });
  const [usr] = await db.insert(users).values({ name: "Mig Smoke", email: `mig-${tag}@t.test`, passwordHash: "x" }).returning({ id: users.id });

  // 0053: an API key per org (default scope/expiry come from the migration).
  const [keyA] = await db.insert(apiKeys).values({ organizationId: orgA.id, name: "kA", keyHash: `hA-${tag}`, keyHint: "sk_a…" }).returning({ id: apiKeys.id });
  await db.insert(apiKeys).values({ organizationId: orgB.id, name: "kB", keyHash: `hB-${tag}`, keyHint: "sk_b…" });

  // 0054: an INVOICED order + a DRAFT invoice per org (link starts null).
  const [soA] = await db.insert(salesOrders).values({ organizationId: orgA.id, number: `SOA-${tag}`, customerId: custA.id, date: new Date(), status: "INVOICED" }).returning({ id: salesOrders.id });
  const [invA] = await db.insert(salesInvoices).values({ organizationId: orgA.id, number: `SIA-${tag}`, customerId: custA.id, date: new Date() }).returning({ id: salesInvoices.id });
  await db.insert(salesInvoices).values({ organizationId: orgB.id, number: `SIB-${tag}`, customerId: custB.id, date: new Date() });

  const app = new Pool({ connectionString: APPUSER_URL });
  const inScope = async (org: string | null, admin: boolean, run: (c: import("pg").PoolClient) => Promise<void>) => {
    const c = await app.connect();
    try {
      await c.query("begin");
      await c.query("select set_config('app.current_org', $1, true), set_config('app.is_platform_admin', $2, true)", [org ?? "", admin ? "on" : "off"]);
      await run(c);
      await c.query("commit");
    } catch (e) { await c.query("rollback"); throw e; } finally { c.release(); }
  };

  try {
    const who = (await app.query("select current_user as u")).rows[0].u;
    check("connected as appuser (RLS enforced, not owner)", who === "appuser", who);

    // ── 0052: users lockout columns (GLOBAL table — no scope needed) ──
    const u0 = (await app.query("select failed_login_attempts, locked_until from users where id=$1", [usr.id])).rows[0];
    check("0052: new user defaults failed_login_attempts=0, locked_until NULL", Number(u0.failed_login_attempts) === 0 && u0.locked_until === null);
    // appuser can write the counters (verifyCredentials runs unscoped at login time).
    await app.query("update users set failed_login_attempts=3 where id=$1", [usr.id]);
    const u1 = (await app.query("select failed_login_attempts from users where id=$1", [usr.id])).rows[0];
    check("0052: appuser can increment failed_login_attempts (unscoped, global table)", Number(u1.failed_login_attempts) === 3);
    await app.query("update users set failed_login_attempts=0, locked_until=null where id=$1", [usr.id]);
    check("0052: appuser can clear the lockout on success", Number((await app.query("select failed_login_attempts from users where id=$1", [usr.id])).rows[0].failed_login_attempts) === 0);

    // ── 0053: api_keys scope/expiry (org-policied) ──
    await inScope(orgA.id, false, async (c) => {
      const rows = (await c.query("select id, scope, expires_at from api_keys")).rows;
      check("0053: scope A sees ONLY A's key (new columns don't widen the row set)", rows.length === 1 && rows[0].id === keyA.id, `${rows.length} rows`);
      check("0053: new key defaults scope='write', expires_at NULL", rows[0]?.scope === "write" && rows[0]?.expires_at === null, rows[0]?.scope);
      await c.query("update api_keys set scope='read', expires_at=now() + interval '30 days' where id=$1", [keyA.id]);
    });
    await inScope(orgA.id, false, async (c) => {
      const r = (await c.query("select scope, expires_at from api_keys where id=$1", [keyA.id])).rows[0];
      check("0053: appuser wrote scope='read' + expiry under scope A", r.scope === "read" && r.expires_at !== null);
    });
    await inScope(orgB.id, false, async (c) => {
      check("0053: scope B cannot see org A's key (isolation holds with new columns)", (await c.query("select id from api_keys where id=$1", [keyA.id])).rowCount === 0);
    });
    check("0053: no scope → fail-closed (0 keys)", (await app.query("select id from api_keys")).rowCount === 0);

    // ── 0054: invoice→order link (org-policied) ──
    await inScope(orgA.id, false, async (c) => {
      const inv = (await c.query("select sales_order_id from sales_invoices where id=$1", [invA.id])).rows[0];
      check("0054: invoice sales_order_id starts NULL", inv.sales_order_id === null);
      // the convert-link write
      await c.query("update sales_invoices set sales_order_id=$1 where id=$2", [soA.id, invA.id]);
      check("0054: appuser linked invoice→order under scope A", (await c.query("select sales_order_id from sales_invoices where id=$1", [invA.id])).rows[0].sales_order_id === soA.id);
      // the reopen-on-delete write (INVOICED → CONFIRMED, guarded on status)
      const upd = await c.query("update sales_orders set status='CONFIRMED' where id=$1 and status='INVOICED'", [soA.id]);
      check("0054: reopen UPDATE flips the INVOICED order to CONFIRMED", upd.rowCount === 1);
    });
    await inScope(orgB.id, false, async (c) => {
      check("0054: scope B cannot see org A's invoice (isolation holds with new column)", (await c.query("select id from sales_invoices where id=$1", [invA.id])).rowCount === 0);
    });
  } finally {
    await app.end();
    // clean children first (FKs), then orgs
    await db.delete(salesInvoices).where(eq(salesInvoices.organizationId, orgA.id));
    await db.delete(salesInvoices).where(eq(salesInvoices.organizationId, orgB.id));
    await db.delete(salesOrders).where(eq(salesOrders.organizationId, orgA.id));
    await db.delete(apiKeys).where(eq(apiKeys.organizationId, orgA.id));
    await db.delete(apiKeys).where(eq(apiKeys.organizationId, orgB.id));
    await db.delete(customers).where(eq(customers.organizationId, orgA.id));
    await db.delete(customers).where(eq(customers.organizationId, orgB.id));
    await db.delete(organizations).where(eq(organizations.id, orgA.id));
    await db.delete(organizations).where(eq(organizations.id, orgB.id));
    await db.delete(users).where(eq(users.id, usr.id));
  }

  console.log(failures === 0 ? "\n✅ new-migration smoke PASSED" : `\n❌ ${failures} check(s) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
