import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { organizations, accounts } from "@/db/schema";
import { postEntry } from "@/lib/erp/posting";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const r2 = (n: number) => Math.round(n * 100) / 100;
const ok = (c: boolean) => (c ? "✅" : "❌");

async function sums(x: Tx, orgId: string) {
  const r = await x.execute<{ d: string; c: string }>(sql`
    SELECT coalesce(sum(jl.debit),0) d, coalesce(sum(jl.credit),0) c
    FROM journal_entry_lines jl JOIN journal_entries je ON je.id = jl.journal_entry_id WHERE je.organization_id = ${orgId}`);
  return { d: Number(r.rows[0].d), c: Number(r.rows[0].c) };
}
async function bal(x: Tx, orgId: string, accId: string) {
  const r = await x.execute<{ b: string }>(sql`
    SELECT coalesce(sum(jl.debit-jl.credit),0) b FROM journal_entry_lines jl
    JOIN journal_entries je ON je.id = jl.journal_entry_id WHERE je.organization_id = ${orgId} AND jl.account_id = ${accId}`);
  return Number(r.rows[0].b);
}

// Verify the purchase-return variance GL (receipt branch) for price≠cost both ways.
async function scenario(tx: Tx, orgId: string, A: Record<string, string>, label: string, net: number, cost: number, tag: string) {
  const before = { s: await sums(tx, orgId), inv: await bal(tx, orgId, A["1104"]), grni: await bal(tx, orgId, A["2103"]), gain: await bal(tx, orgId, A["4201"]), loss: await bal(tx, orgId, A["5301"]) };
  const variance = r2(net - cost);
  const glLines = [
    { accountId: A["2103"], debit: net, credit: 0, description: "grni" },
    { accountId: A["1104"], debit: 0, credit: cost, description: "inv" },
  ];
  if (variance > 0) glLines.push({ accountId: A["4201"], debit: 0, credit: variance, description: "gain" });
  else if (variance < 0) glLines.push({ accountId: A["5301"], debit: -variance, credit: 0, description: "loss" });
  await postEntry(tx, { orgId, date: new Date("2026-06-01"), sourceType: "PURCHASE_RETURN", sourceId: `CHK-${tag}`, description: "test", journalType: "PURCHASE", lines: glLines });
  const after = { s: await sums(tx, orgId), inv: await bal(tx, orgId, A["1104"]), grni: await bal(tx, orgId, A["2103"]), gain: await bal(tx, orgId, A["4201"]), loss: await bal(tx, orgId, A["5301"]) };
  console.log(`${ok(r2(after.s.d) === r2(after.s.c))} [${label}] books balanced (${r2(after.s.d)}==${r2(after.s.c)})`);
  console.log(`${ok(r2(after.inv - before.inv) === -cost)} [${label}] 1104 Δ=${r2(after.inv - before.inv)} (expect ${-cost})`);
  console.log(`${ok(r2(after.grni - before.grni) === net)} [${label}] 2103 Δ=${r2(after.grni - before.grni)} (expect ${net})`);
  const varAcct = variance > 0 ? after.gain - before.gain : after.loss - before.loss;
  console.log(`${ok(r2(Math.abs(varAcct)) === r2(Math.abs(variance)))} [${label}] variance ${variance > 0 ? "4201" : "5301"} = ${r2(Math.abs(varAcct))} (expect ${r2(Math.abs(variance))})`);
}

async function main() {
  const [org] = await db.select().from(organizations).limit(1);
  const orgId = org.id;
  const accs = await db.select({ code: accounts.code, id: accounts.id }).from(accounts)
    .where(and(eq(accounts.organizationId, orgId), inArray(accounts.code, ["1104", "2103", "4201", "5301"])));
  const A = Object.fromEntries(accs.map((a) => [a.code, a.id]));
  try {
    await db.transaction(async (tx) => {
      await scenario(tx, orgId, A, "favorable price>cost", 100, 70, "fav");
      await scenario(tx, orgId, A, "unfavorable price<cost", 70, 100, "unf");
      throw new Error("ROLLBACK");
    });
  } catch (e) {
    if (e instanceof Error && e.message === "ROLLBACK") { console.log("— rolled back —"); process.exit(0); }
    console.error(e); process.exit(1);
  }
}
main();
