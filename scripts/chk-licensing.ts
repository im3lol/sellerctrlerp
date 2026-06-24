import { organizations } from "@/db/schema";
import { db } from "@/lib/db";
import { generateCode, hashCode, codeHint } from "@/lib/erp/activation";
import { getEnabledModules, ALL_MODULES } from "@/lib/erp/entitlements";

const ok = (c: boolean) => (c ? "✅" : "❌");

async function main() {
  // (1) Code crypto round-trip.
  const code = generateCode();
  const fmt = /^[0-9A-F]{4}(-[0-9A-F]{4}){4}$/.test(code);
  const h1 = hashCode(code);
  const h2 = hashCode(code.toLowerCase().replace(/-/g, " ")); // tolerant of case/format
  const hint = codeHint(code);
  console.log(`${ok(fmt)} format ${code}`);
  console.log(`${ok(h1.length === 64)} hash is sha256 hex (64)`);
  console.log(`${ok(h1 === h2)} hash tolerant of case/format (normalized)`);
  console.log(`${ok(hint.includes("••••") && hint.endsWith(code.split("-").pop()!))} hint masks all but last group: ${hint}`);
  console.log(`${ok(hashCode(generateCode()) !== h1)} distinct codes → distinct hashes`);

  // (2) Entitlements: demo org has no subscription → all modules (grandfathered).
  const [org] = await db.select().from(organizations).limit(1);
  const mods = await getEnabledModules(org.id);
  console.log(`${ok(mods.size === ALL_MODULES.length)} no-subscription org grandfathered to all ${mods.size}/${ALL_MODULES.length} modules`);

  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
