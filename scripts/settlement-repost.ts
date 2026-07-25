/**
 * Headless maintenance runner for the Amazon-settlement correction — the same
 * reverseSettlementPosting / postSettlements the «عكس ترحيل التسوية» + «ترحيل»
 * buttons call, but runnable without a browser session for a one-off remediation.
 *
 *   DATABASE_URL=… npx tsx scripts/settlement-repost.ts reverse <orgId>
 *   DATABASE_URL=… npx tsx scripts/settlement-repost.ts post    <orgId>
 *
 * `reverse` un-posts every settlement entry + restores the subledger (safe, idempotent).
 * `post` rebuilds per-order collection entries + one aggregated fees entry. The refund
 * sub-cycle is skipped here (it needs a request session) — run it later from the UI.
 */
import { reverseSettlementPosting, postSettlements } from "@/lib/erp/settlement-core";

async function main() {
  const cmd = process.argv[2];
  const orgId = process.argv[3];
  if (!orgId || (cmd !== "reverse" && cmd !== "post")) {
    console.error("usage: settlement-repost.ts reverse|post <orgId>");
    process.exit(2);
  }
  const r = cmd === "reverse"
    ? await reverseSettlementPosting(orgId, null)
    : await postSettlements(orgId, null);
  console.log(JSON.stringify(r, null, 2));
  process.exit("error" in r ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
