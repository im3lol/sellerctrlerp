/**
 * Print the platform P&L the way the page computes it. Read-only.
 *
 *   DATABASE_URL=... npx tsx --tsconfig tsconfig.script.json scripts/checks/chk-platform-pnl.ts
 *
 * The card reported sales 0.00, cost 0.00 and a "net" that was just the fees negated.
 * This calls the real engine so the fix is checked against the engine, not against a
 * query written to agree with it.
 */
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { organizations, salesPlatforms } from "@/db/schema";
import { getPlatformPnl } from "@/lib/erp/platform-pnl";

const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function main() {
  for (const org of await db.select({ id: organizations.id, name: organizations.nameAr }).from(organizations)) {
    const platforms = await db.select({ id: salesPlatforms.id, code: salesPlatforms.code, name: salesPlatforms.name })
      .from(salesPlatforms).where(eq(salesPlatforms.organizationId, org.id));
    if (!platforms.length) continue;
    console.log(`\n${org.name}`);
    for (const p of platforms) {
      const r = await getPlatformPnl(org.id, p.code, p.id);
      console.log(`  ${p.name} (${p.code})`);
      console.log(`    units            ${r.units}`);
      console.log(`    revenue          ${money(r.revenue)}`);
      console.log(`    cogs             ${money(r.cogs)}`);
      console.log(`    referral / fba   ${money(r.referralFee)} / ${money(r.fbaFee)}`);
      console.log(`    other fees       ${money(r.otherFee)}`);
      console.log(`    ─────────────────────────────`);
      console.log(`    net              ${money(r.net)}  (${r.margin.toFixed(1)}%)`);
      console.log(`    check            ${money(r.revenue)} − ${money(r.cogs)} − ${money(r.fees)} = ${money(r.revenue - r.cogs - r.fees)}`);
      if (!r.hasSettlement) console.log("    !! no settlements yet — fees are incomplete");
    }
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
