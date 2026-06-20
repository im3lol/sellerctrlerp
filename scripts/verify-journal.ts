/**
 * Behaviour test for the manual-JE engine: draft → post → reverse, with
 * assertions, then cleanup so the demo data is left untouched.
 * Run: npx tsx scripts/verify-journal.ts
 */
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db, pool } from "@/lib/db";
import { organizations, accounts, journalEntries, journalEntryLines } from "@/db/schema";
import { postDraft, reverseEntry } from "@/lib/erp/posting";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error("ASSERT FAILED: " + msg);
  console.log("  ✓ " + msg);
}

async function main() {
  const [org] = await db.select().from(organizations).limit(1);
  assert(org, "found demo organization: " + org?.nameAr);

  const leaves = await db
    .select({ id: accounts.id, code: accounts.code, nameAr: accounts.nameAr })
    .from(accounts)
    .where(and(eq(accounts.organizationId, org.id), eq(accounts.isLeaf, true), eq(accounts.allowManualEntries, true)))
    .orderBy(asc(accounts.code))
    .limit(2);
  assert(leaves.length === 2, `have 2 postable leaf accounts (${leaves.map((l) => l.code).join(", ")})`);

  const srcId = randomUUID();
  console.log("\n[1] create DRAFT entry (500 Dr / 500 Cr)");
  const draftId = await db.transaction(async (tx) => {
    const [e] = await tx
      .insert(journalEntries)
      .values({
        organizationId: org.id,
        number: `DR-TEST-${Date.now()}`,
        date: new Date(2026, 5, 15),
        description: "اختبار قيد يدوي (سيُحذف)",
        status: "DRAFT",
        sourceType: "MANUAL",
        sourceId: srcId,
      })
      .returning({ id: journalEntries.id });
    await tx.insert(journalEntryLines).values([
      { journalEntryId: e.id, accountId: leaves[0].id, debit: "500.00", credit: "0.00", description: "مدين اختبار" },
      { journalEntryId: e.id, accountId: leaves[1].id, debit: "0.00", credit: "500.00", description: "دائن اختبار" },
    ]);
    return e.id;
  });
  assert(draftId, "draft inserted");

  console.log("\n[2] postDraft → POSTED + JV number");
  await db.transaction((tx) => postDraft(tx, { orgId: org.id, entryId: draftId }));
  const [posted] = await db.select().from(journalEntries).where(eq(journalEntries.id, draftId));
  assert(posted.status === "POSTED", "status is POSTED");
  assert(/^JV-2026-\d{4}$/.test(posted.number), "renumbered to " + posted.number);
  assert(posted.postedAt != null, "postedAt set");

  console.log("\n[3] reverseEntry → original REVERSED + mirror entry");
  const revId = await db.transaction((tx) =>
    reverseEntry(tx, { orgId: org.id, entryId: draftId, date: new Date(2026, 5, 16), reason: "اختبار العكس" }),
  );
  const [orig] = await db.select().from(journalEntries).where(eq(journalEntries.id, draftId));
  const [rev] = await db.select().from(journalEntries).where(eq(journalEntries.id, revId));
  assert(orig.status === "REVERSED", "original is REVERSED");
  assert(orig.reversedById === revId, "original.reversedById points to mirror");
  assert(rev.sourceType === "REVERSAL" && rev.sourceId === draftId, "mirror sourceType=REVERSAL, sourceId=original");

  const origLines = await db.select().from(journalEntryLines).where(eq(journalEntryLines.journalEntryId, draftId));
  const revLines = await db.select().from(journalEntryLines).where(eq(journalEntryLines.journalEntryId, revId));
  const sum = (rows: typeof origLines, k: "debit" | "credit") => rows.reduce((s, r) => s + Number(r[k]), 0);
  assert(sum(origLines, "debit") === sum(revLines, "credit"), "mirror credit == original debit (swapped)");
  assert(sum(origLines, "credit") === sum(revLines, "debit"), "mirror debit == original credit (swapped)");
  assert(sum(revLines, "debit") === sum(revLines, "credit"), "mirror is itself balanced");

  console.log("\n[4] double-reverse is blocked by unique index");
  let blocked = false;
  try {
    await db.transaction((tx) => reverseEntry(tx, { orgId: org.id, entryId: draftId }));
  } catch {
    blocked = true;
  }
  assert(blocked, "second reverse rejected");

  console.log("\n[cleanup] removing test entries");
  await db.delete(journalEntryLines).where(inArray(journalEntryLines.journalEntryId, [draftId, revId]));
  // Clear the FK first so the original can be deleted.
  await db.update(journalEntries).set({ reversedById: null }).where(eq(journalEntries.id, draftId));
  await db.delete(journalEntries).where(inArray(journalEntries.id, [draftId, revId]));
  const [gone] = await db.select().from(journalEntries).where(eq(journalEntries.id, draftId));
  assert(!gone, "test entries deleted (demo data restored)");

  console.log("\nALL JOURNAL ENGINE CHECKS PASSED ✅");
}

main()
  .catch((e) => {
    console.error("\n❌", e.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
