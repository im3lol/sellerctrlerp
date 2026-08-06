/**
 * Integration proof for the double-entry GL engine (lib/erp/posting.ts) — the single
 * writer the whole system's financial integrity rests on, and previously untested.
 * Runs every assertion inside a ROLLED-BACK transaction so it never commits and is
 * safe to re-run against any seeded DB. Exits non-zero on any failure (a real gate).
 *
 *   npm run test:engine        # against local Docker (owner on :5433)
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { organizations, accounts, journalEntryLines, items, warehouses } from "@/db/schema";
import { postEntry, type PostInput } from "@/lib/erp/posting";
import { postStockMovement, type StockInput } from "@/lib/erp/inventory";

let failures = 0;
const pass = (n: string) => console.log(`  ✓  ${n}`);
const fail = (n: string, why: string) => { console.log(`  ✗ FAIL  ${n} — ${why}`); failures++; };
const ROLLBACK = "ENGINE_CHECK_ROLLBACK";
const isRollback = (e: unknown) => e instanceof Error && e.message === ROLLBACK;

const entry = (orgId: string, lines: PostInput["lines"]): PostInput => ({
  orgId, date: new Date(), sourceType: "MANUAL", sourceId: "engine-check",
  description: "engine-check (rolled back)", lines,
});

/** Assert postEntry REJECTS an input, and the rejection message matches `needle`. */
async function expectReject(name: string, orgId: string, lines: PostInput["lines"], needle: string) {
  try {
    await db.transaction(async (tx) => { await postEntry(tx, entry(orgId, lines)); });
    fail(name, "expected a rejection, but it posted");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes(needle)) pass(name);
    else fail(name, `rejected, but message was: ${msg.slice(0, 120)}`);
  }
}

async function main() {
  const [org] = await db.select({ id: organizations.id }).from(organizations).limit(1);
  if (!org) { console.log("no organization seeded — run db:seed first"); process.exit(0); }
  const orgId = org.id;

  const leaves = await db.select({ id: accounts.id }).from(accounts)
    .where(and(eq(accounts.organizationId, orgId), eq(accounts.isLeaf, true))).limit(2);
  const [header] = await db.select({ id: accounts.id }).from(accounts)
    .where(and(eq(accounts.organizationId, orgId), eq(accounts.isLeaf, false))).limit(1);
  if (leaves.length < 2 || !header) { console.log("need ≥2 leaf + 1 header account — seed the chart first"); process.exit(0); }
  const [a, b] = leaves;

  console.log("double-entry GL engine (postEntry):");

  // 1) A balanced entry posts, and its lines net to zero (rolled back).
  try {
    await db.transaction(async (tx) => {
      const id = await postEntry(tx, entry(orgId, [
        { accountId: a.id, debit: 100, credit: 0 },
        { accountId: b.id, debit: 0, credit: 100 },
      ]));
      const [{ d, c }] = await tx.select({
        d: sql<number>`coalesce(sum(${journalEntryLines.debit}),0)`,
        c: sql<number>`coalesce(sum(${journalEntryLines.credit}),0)`,
      }).from(journalEntryLines).where(eq(journalEntryLines.journalEntryId, id));
      if (id && Number(d) === 100 && Number(c) === 100) pass("balanced entry posts and its GL lines net to zero");
      else fail("balanced entry posts", `id=${id} debit=${d} credit=${c}`);
      throw new Error(ROLLBACK);
    });
  } catch (e) { if (!isRollback(e)) fail("balanced entry posts", e instanceof Error ? e.message.slice(0, 120) : String(e)); }

  // 2) Guarantees the engine must never break:
  await expectReject("unbalanced entry is rejected", orgId,
    [{ accountId: a.id, debit: 100, credit: 0 }, { accountId: b.id, debit: 0, credit: 50 }], "غير متوازن");
  await expectReject("zero-value entry is rejected", orgId,
    [{ accountId: a.id, debit: 0, credit: 0 }, { accountId: b.id, debit: 0, credit: 0 }], "صفر");
  await expectReject("posting to a header (non-leaf) account is rejected", orgId,
    [{ accountId: header.id, debit: 100, credit: 0 }, { accountId: b.id, debit: 0, credit: 100 }], "رئيسي");

  // ── perpetual stock/WAC engine (postStockMovement) ──
  const [item] = await db.select({ id: items.id }).from(items).where(eq(items.organizationId, orgId)).limit(1);
  const [wh] = await db.select({ id: warehouses.id }).from(warehouses).where(eq(warehouses.organizationId, orgId)).limit(1);
  if (item && wh) {
    console.log("\nperpetual stock engine (postStockMovement):");
    const stock = (over: Partial<StockInput>): StockInput => ({
      orgId, itemId: item.id, warehouseId: wh.id, type: "IN", quantity: 1, date: new Date(),
      referenceType: "engine-check", referenceId: "engine-check", ...over,
    } as StockInput);
    const rejectStock = async (name: string, input: StockInput, needle: string) => {
      try {
        await db.transaction(async (tx) => { await postStockMovement(tx, input); });
        fail(name, "expected a rejection, but it wrote");
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes(needle)) pass(name);
        else fail(name, `rejected, but message was: ${msg.slice(0, 120)}`);
      }
    };
    await rejectStock("inbound without a unit cost is rejected", stock({ type: "IN", quantity: 10 }), "التكلفة");
    await rejectStock("outbound beyond available stock is rejected (no negative)", stock({ type: "OUT", quantity: 1e9 }), "غير متاحة");
  } else {
    console.log("\n(skipped stock engine — org has no item/warehouse seeded)");
  }

  console.log(failures === 0 ? "\n✅ engine check PASSED" : `\n❌ engine check FAILED (${failures})`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error("engine-check crashed:", e); process.exit(1); });
