/**
 * Print what Amazon actually returns for one order. Read-only — two GETs, no writes.
 *
 *   DATABASE_URL=... npx tsx --tsconfig tsconfig.script.json \
 *     scripts/checks/chk-amazon-order-raw.ts 404-8234280-6421164
 *
 * Exists because the order total was wrong and the guesses were cheap: maybe the promotion
 * field was empty, maybe the mapper dropped it. Guessing about someone's money is the wrong
 * move — this shows the payload and the arithmetic side by side so the answer is a fact.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { platformCredentials, organizations } from "@/db/schema";
import { decryptSecret } from "@/lib/crypto";
import { spJson } from "@/lib/erp/marketplace/amazon/client";
import { round2 } from "@/lib/erp/money";
import type { Credential } from "@/lib/erp/marketplace/connector";

const orderId = process.argv[2];
if (!orderId) { console.error("usage: … chk-amazon-order-raw.ts <AmazonOrderId>"); process.exit(1); }

const amt = (m?: { Amount?: string | number }) => Number(m?.Amount ?? 0) || 0;
const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function main() {
  const orgs = await db.select({ id: organizations.id, name: organizations.nameAr }).from(organizations);
  let cred: Credential | null = null;
  for (const o of orgs) {
    const [row] = await db.select().from(platformCredentials)
      .where(and(eq(platformCredentials.organizationId, o.id), eq(platformCredentials.provider, "amazon"))).limit(1);
    if (!row) continue;
    const refreshToken = decryptSecret(row.refreshToken);
    if (!refreshToken) continue;
    cred = { refreshToken, sellerId: row.sellerId, marketplaceId: row.marketplaceId, region: row.region };
    console.log(`using ${o.name}'s Amazon credential`);
    break;
  }
  if (!cred) { console.error("no usable Amazon credential found"); process.exit(1); }

  const order = await spJson<{ payload?: Record<string, unknown> }>(cred, `/orders/v0/orders/${encodeURIComponent(orderId)}`);
  const items = await spJson<{ payload?: { OrderItems?: Record<string, unknown>[] } }>(cred, `/orders/v0/orders/${encodeURIComponent(orderId)}/orderItems`);

  console.log("\n── getOrders ────────────────────────────────────────────");
  console.log(JSON.stringify(order.payload, null, 2));
  console.log("\n── getOrderItems ────────────────────────────────────────");
  console.log(JSON.stringify(items.payload?.OrderItems, null, 2));

  // The comparison that matters: what the components add up to, versus what Amazon says
  // the buyer was charged. A gap here IS the bug.
  const its = items.payload?.OrderItems ?? [];
  const sum = (k: string) => round2(its.reduce((s, it) => s + amt(it[k] as { Amount?: string }), 0));
  const itemPrice = sum("ItemPrice"), shipping = sum("ShippingPrice");
  const promo = round2(sum("PromotionDiscount") + sum("ShipPromotionDiscount"));
  const reported = amt((order.payload as { OrderTotal?: { Amount?: string } })?.OrderTotal);

  console.log("\n── the arithmetic ───────────────────────────────────────");
  console.log(`  ItemPrice            ${money(itemPrice)}`);
  console.log(`  ShippingPrice      + ${money(shipping)}`);
  console.log(`  promotions         − ${money(promo)}`);
  console.log(`  ─────────────────────────────`);
  console.log(`  components         = ${money(round2(itemPrice + shipping - promo))}`);
  console.log(`  Amazon OrderTotal    ${money(reported)}`);
  const gap = round2(itemPrice + shipping - promo - reported);
  console.log(`  gap                  ${money(gap)}  ${Math.abs(gap) < 0.01 ? "(they agree)" : "← this is what lands in the ERP as an overstatement"}`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
