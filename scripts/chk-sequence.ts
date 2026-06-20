/**
 * Proves the atomic document-number allocator is concurrency-safe:
 *   1) fire N concurrent allocations of a throwaway key → expect exactly the
 *      contiguous set 1..N (no duplicates, no gaps);
 *   2) confirm real prefixes continue after the seeded numbers.
 * Pollution is cleaned by the next re-seed (it wipes + re-syncs sequences).
 */
import { sql } from "drizzle-orm";
import { db, pool } from "@/lib/db";
import { organizations } from "@/db/schema";
import { nextDocumentNumber } from "@/lib/erp/sequence";

async function main() {
  const [org] = await db.select().from(organizations).limit(1);

  const KEY = "ZZTEST";
  await db.execute(sql`DELETE FROM document_sequences WHERE organization_id=${org.id} AND key=${KEY}`);
  const N = 50;
  const results = await Promise.all(Array.from({ length: N }, () => nextDocumentNumber(db, org.id, KEY, 2099)));
  const nums = results.map((r) => Number(r.split("-").pop()));
  const unique = new Set(nums);
  const contiguous = unique.size === N && Array.from({ length: N }, (_, i) => i + 1).every((e) => unique.has(e));
  console.log(`Concurrency: ${N} parallel allocations → ${unique.size} unique values ${contiguous ? "✅ no duplicates, contiguous 1.." + N : "❌ DUPLICATES OR GAPS: " + JSON.stringify(nums.sort((a, b) => a - b))}`);
  await db.execute(sql`DELETE FROM document_sequences WHERE organization_id=${org.id} AND key=${KEY}`);

  const si = await nextDocumentNumber(db, org.id, "SI", 2026);
  const po = await nextDocumentNumber(db, org.id, "PO", 2026);
  const jv = await nextDocumentNumber(db, org.id, "JV", 2026);
  console.log("Continuation after seed →", "SI:", si, " PO:", po, " JV:", jv);
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => pool.end());
