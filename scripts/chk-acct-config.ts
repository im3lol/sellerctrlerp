import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { organizations, accounts, accountingConfigurations } from "@/db/schema";
import { resolveAccountIds } from "@/lib/erp/accounting-config";

const ok = (c: boolean) => (c ? "✅" : "❌");

// Rolled-back proof that resolveAccountIds (1) returns the default code→id map
// when no config override exists, and (2) swaps in the configured account when
// accounting_configurations sets one — without touching the GL.
async function main() {
  const [org] = await db.select().from(organizations).limit(1);
  const orgId = org.id;

  const accs = await db.select({ code: accounts.code, id: accounts.id }).from(accounts)
    .where(and(eq(accounts.organizationId, orgId), inArray(accounts.code, ["1103", "4101"])));
  const id1103 = accs.find((a) => a.code === "1103")?.id;
  const id4101 = accs.find((a) => a.code === "4101")?.id;
  if (!id1103 || !id4101) { console.log("missing 1103/4101 — seed first"); process.exit(0); }

  // (1) Baseline: with no override (seed default), each code maps to itself.
  const base = await resolveAccountIds(orgId, ["1103", "4101"]);
  console.log(`${ok(base["1103"] === id1103)} baseline 1103 → its own account`);
  console.log(`${ok(base["4101"] === id4101)} baseline 4101 → its own account`);

  // (2) Override path: point receivable (1103 role) at the 4101 account, rolled back.
  try {
    await db.transaction(async (tx) => {
      await tx.delete(accountingConfigurations).where(eq(accountingConfigurations.organizationId, orgId));
      await tx.insert(accountingConfigurations).values({ organizationId: orgId, receivableAccountId: id4101 });
      const over = await resolveAccountIds(orgId, ["1103", "4101"], tx);
      console.log(`${ok(over["1103"] === id4101)} override: 1103 role now resolves to the configured account`);
      console.log(`${ok(over["4101"] === id4101)} non-overridden 4101 still resolves to its own account`);
      throw new Error("ROLLBACK");
    });
  } catch (e) {
    if (e instanceof Error && e.message === "ROLLBACK") { console.log("— rolled back —"); process.exit(0); }
    console.error(e); process.exit(1);
  }
}
main();
