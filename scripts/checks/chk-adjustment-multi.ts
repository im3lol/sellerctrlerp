import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { organizations, accounts } from "@/db/schema";
import { postEntry } from "@/lib/erp/posting";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const round2 = (n: number) => Math.round(n * 100) / 100;
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

// Verify the multi-line adjustment GL netting (surplus 100 + deficit 40).
async function main() {
  const [org] = await db.select().from(organizations).limit(1);
  const orgId = org.id;
  const accs = await db.select({ code: accounts.code, id: accounts.id }).from(accounts)
    .where(and(eq(accounts.organizationId, orgId), inArray(accounts.code, ["1104", "4201", "5301"])));
  const A = Object.fromEntries(accs.map((a) => [a.code, a.id]));

  const surplus = 100, deficit = 40;
  const net1104 = round2(surplus - deficit);

  try {
    await db.transaction(async (tx) => {
      const b = { s: await sums(tx, orgId), inv: await bal(tx, orgId, A["1104"]), sur: await bal(tx, orgId, A["4201"]), def: await bal(tx, orgId, A["5301"]) };

      const glLines: { accountId: string; debit: number; credit: number; description: string }[] = [];
      if (net1104 > 0) glLines.push({ accountId: A["1104"], debit: net1104, credit: 0, description: "net" });
      else if (net1104 < 0) glLines.push({ accountId: A["1104"], debit: 0, credit: -net1104, description: "net" });
      if (surplus > 0) glLines.push({ accountId: A["4201"], debit: 0, credit: round2(surplus), description: "surplus" });
      if (deficit > 0) glLines.push({ accountId: A["5301"], debit: round2(deficit), credit: 0, description: "deficit" });

      await postEntry(tx, { orgId, date: new Date(), sourceType: "STOCK_ADJUSTMENT", sourceId: `TEST-${org.id}`, description: "test multi adj", journalType: "GENERAL", lines: glLines });

      const a = { s: await sums(tx, orgId), inv: await bal(tx, orgId, A["1104"]), sur: await bal(tx, orgId, A["4201"]), def: await bal(tx, orgId, A["5301"]) };
      console.log(`${ok(round2(a.s.d) === round2(a.s.c))} books balanced AFTER (${round2(a.s.d)} == ${round2(a.s.c)})`);
      console.log(`${ok(round2(a.inv - b.inv) === net1104)} GL 1104 Δ = ${round2(a.inv - b.inv)} (expect ${net1104})`);
      console.log(`${ok(round2(a.sur - b.sur) === -surplus)} GL 4201 Δ = ${round2(a.sur - b.sur)} (expect ${-surplus})`);
      console.log(`${ok(round2(a.def - b.def) === deficit)} GL 5301 Δ = ${round2(a.def - b.def)} (expect ${deficit})`);

      throw new Error("ROLLBACK");
    });
  } catch (e) {
    if (e instanceof Error && e.message === "ROLLBACK") { console.log("— rolled back —"); process.exit(0); }
    console.error(e); process.exit(1);
  }
}
main();
