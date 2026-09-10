/**
 * Move Amazon's fee data onto listTransactions as its single source.
 *
 * The rows already stored came from the settlement flat file and are keyed
 * `settlementId|type|orderId|sku|postedAt|total`. listTransactions keys on the shipment,
 * which survives DEFERRED → RELEASED. Left side by side, the SAME order would land twice
 * under two different keys and double its fees — the exact thing the shipment key prevents
 * within one source. So the old rows go, and the feed re-supplies them in full.
 *
 * Safe because nothing was ever posted from them: the script REFUSES to delete any row
 * carrying a journal_entry_id, so if that ever stops being true it stops rather than
 * orphaning a journal entry.
 *
 * Preview by default. Pass --apply to delete and re-pull.
 *
 *   DATABASE_URL=... npx tsx --tsconfig tsconfig.script.json scripts/cutover-amazon-transactions.ts
 *   … scripts/cutover-amazon-transactions.ts --apply
 */
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { organizations, marketplaceSettlementTxns } from "@/db/schema";
import { withOrgScope } from "@/lib/db-scope";
import { prepareSync, syncSettlementsCore } from "@/lib/erp/marketplace/sync-core";

const APPLY = process.argv.includes("--apply");
const days = Number(process.argv.find((a) => /^--days=/.test(a))?.split("=")[1]) || 90;
const CHANNEL = "AMAZON";

async function main() {
  for (const org of await db.select({ id: organizations.id, name: organizations.nameAr }).from(organizations)) {
    const where = and(eq(marketplaceSettlementTxns.organizationId, org.id), eq(marketplaceSettlementTxns.channel, CHANNEL));

    const [before] = await db.select({
      n: sql<number>`count(*)::int`,
      fees: sql<string>`coalesce(-sum(${marketplaceSettlementTxns.sellingFees} + ${marketplaceSettlementTxns.fbaFees} + ${marketplaceSettlementTxns.otherTransactionFees}), 0)`,
    }).from(marketplaceSettlementTxns).where(where);
    if (!Number(before?.n)) continue;

    const [posted] = await db.select({ n: sql<number>`count(*)::int` })
      .from(marketplaceSettlementTxns)
      .where(and(where, isNotNull(marketplaceSettlementTxns.journalEntryId)));

    console.log(`\n${org.name}`);
    console.log(`  stored now : ${before?.n} rows, ${Number(before?.fees).toFixed(2)} of fees`);
    console.log(`  GL-posted  : ${posted?.n}`);
    if (Number(posted?.n) > 0) {
      console.log("  !! some rows are posted to the ledger — refusing to delete. Reverse them first.");
      continue;
    }
    if (!APPLY) { console.log("  preview only — re-run with --apply to replace them from listTransactions"); continue; }

    await withOrgScope(org.id, false, async () => {
      const del = await db.delete(marketplaceSettlementTxns).where(where);
      console.log(`  deleted    : ${del.rowCount ?? 0} flat-file rows`);
    });

    const prep = await prepareSync(org.id, CHANNEL);
    if ("error" in prep) { console.log(`  !! ${prep.error}`); continue; }
    const from = new Date(Date.now() - days * 864e5);
    const res = await syncSettlementsCore(prep, { from, to: new Date() });
    if (!res.ok) { console.log(`  !! pull failed: ${res.error}`); continue; }
    console.log(`  pulled     : ${res.imported} new, ${res.updated} updated (last ${days} days)`);

    const [after] = await db.select({
      n: sql<number>`count(*)::int`,
      deferred: sql<number>`count(*) filter (where ${marketplaceSettlementTxns.status} = 'Deferred')::int`,
      fees: sql<string>`coalesce(-sum(${marketplaceSettlementTxns.sellingFees} + ${marketplaceSettlementTxns.fbaFees} + ${marketplaceSettlementTxns.otherTransactionFees}), 0)`,
    }).from(marketplaceSettlementTxns).where(where);
    console.log(`  now        : ${after?.n} rows (${after?.deferred} deferred), ${Number(after?.fees).toFixed(2)} of fees`);
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
