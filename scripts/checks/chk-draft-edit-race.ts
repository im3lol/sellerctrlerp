/**
 * Proves the draft-edit ↔ post race is closed at the choke point (lib/erp/posting.ts).
 *
 * Editing a DRAFT replaces its lines wholesale. Before the fix, postDraft read the lines
 * with no lock held, so it validated one set of lines and committed a different one:
 * «تأكيد» landing mid-edit would run its leaf/balance/allowManualEntries checks against
 * the lines it happened to see, then stamp the entry POSTED carrying the edited ones.
 * postDraft now takes the entry row FOR UPDATE first, which is the same lock the edit
 * path holds, so it can only ever read lines that are already final.
 *
 * The test drives the exact interleaving: hold the row the way an edit does, rewrite the
 * lines onto a HEADER account (which posting must always reject), commit, and let the
 * concurrent post resume. It must reject. Passing without the lock means it validated
 * the pre-edit lines and posted an entry that violates the rule.
 *
 * Commits nothing: the post attempt always rolls back and the draft is deleted.
 *
 *   npx tsx scripts/checks/chk-draft-edit-race.ts
 */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, pool } from "@/lib/db";
import { organizations, accounts, journalEntries, journalEntryLines } from "@/db/schema";
import { postDraft } from "@/lib/erp/posting";

const ROLLBACK = "CHK_ROLLBACK";
let failures = 0;
const pass = (n: string) => console.log(`  ✓  ${n}`);
const fail = (n: string, why: string) => { console.log(`  ✗ FAIL  ${n} — ${why}`); failures++; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const causes = (e: unknown) => {
  const out: string[] = [];
  for (let c: unknown = e; c instanceof Error; c = (c as { cause?: unknown }).cause) out.push(c.message);
  return out;
};

async function main() {
  const [org] = await db.select({ id: organizations.id }).from(organizations).limit(1);
  if (!org) { console.log("no organization seeded — run db:seed first"); process.exit(0); }
  const leaves = await db.select({ id: accounts.id }).from(accounts)
    .where(and(eq(accounts.organizationId, org.id), eq(accounts.isLeaf, true), eq(accounts.allowManualEntries, true))).limit(2);
  const [header] = await db.select({ id: accounts.id }).from(accounts)
    .where(and(eq(accounts.organizationId, org.id), eq(accounts.isLeaf, false))).limit(1);
  if (leaves.length < 2 || !header) { console.log("need ≥2 manual leaf accounts + 1 header account — seed the chart first"); process.exit(0); }

  // A committed, valid DRAFT to race over. Deleted in the finally below.
  const [entry] = await db.insert(journalEntries).values({
    organizationId: org.id, number: `CHK-RACE-${randomUUID().slice(0, 8)}`, date: new Date(),
    description: "chk-draft-edit-race (temp)", status: "DRAFT", sourceType: "MANUAL", sourceId: randomUUID(),
  }).returning({ id: journalEntries.id });
  await db.insert(journalEntryLines).values([
    { journalEntryId: entry.id, accountId: leaves[0].id, debit: "100.00", credit: "0.00" },
    { journalEntryId: entry.id, accountId: leaves[1].id, debit: "0.00", credit: "100.00" },
  ]);

  const editor = await pool.connect();
  const name = "a post cannot commit lines it never validated";
  try {
    // The edit: lock the entry, replace its lines with ones posting must reject.
    await editor.query("BEGIN");
    await editor.query("SELECT id FROM journal_entries WHERE id = $1 FOR UPDATE", [entry.id]);
    await editor.query("DELETE FROM journal_entry_lines WHERE journal_entry_id = $1", [entry.id]);
    await editor.query(
      `INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit)
       VALUES ($1,$2,'100.00','0.00'), ($1,$3,'0.00','100.00')`,
      [entry.id, header.id, leaves[1].id]);

    // The confirm, racing it. Without the lock it reads the pre-edit lines here.
    const posting = db.transaction(async (tx) => {
      await postDraft(tx, { orgId: org.id, entryId: entry.id, userId: null });
      throw new Error(ROLLBACK); // never commit, even when the guard is missing
    });
    const settled = posting.then(() => "resolved").catch((e: unknown) => causes(e));

    await sleep(400);          // let the post get as far as it can
    await editor.query("COMMIT"); // edit lands; the post resumes

    const result = await settled;
    if (Array.isArray(result) && result.some((m) => m.includes("حساب رئيسي"))) pass(name);
    else if (Array.isArray(result) && result[0] === ROLLBACK) {
      fail(name, "posted the edited lines after validating the pre-edit ones (FOR UPDATE missing in postDraft)");
    } else fail(name, `unexpected outcome: ${JSON.stringify(result).slice(0, 160)}`);
  } finally {
    await editor.query("ROLLBACK").catch(() => {});
    editor.release();
    await db.delete(journalEntries).where(eq(journalEntries.id, entry.id));
  }

  console.log(failures ? `\n${failures} failure(s)` : "\nall good");
  await pool.end();
  process.exit(failures ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
