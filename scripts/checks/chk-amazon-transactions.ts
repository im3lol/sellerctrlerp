/**
 * Print what Finances 2024-06-19 `listTransactions` actually returns. Read-only.
 *
 *   DATABASE_URL=... npx tsx --tsconfig tsconfig.script.json \
 *     scripts/checks/chk-amazon-transactions.ts [days]
 *
 * The settlement flat file the connector reads only carries money Amazon has already
 * RELEASED, so a transaction deferred under the delivery-date policy shows no fees at all
 * until it settles — which is why 19 orders had 6 fee rows between them. listTransactions
 * returns deferred and released alike, with the fee breakdown itemised the way Seller
 * Central's Transaction details page shows it. This dumps the raw shape so the mapping is
 * written against the payload rather than against the documentation.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { platformCredentials, organizations } from "@/db/schema";
import { decryptSecret } from "@/lib/crypto";
import { spJson } from "@/lib/erp/marketplace/amazon/client";
import type { Credential } from "@/lib/erp/marketplace/connector";

const days = Number(process.argv[2]) || 30;

async function main() {
  let cred: Credential | null = null;
  for (const o of await db.select({ id: organizations.id, name: organizations.nameAr }).from(organizations)) {
    const [row] = await db.select().from(platformCredentials)
      .where(and(eq(platformCredentials.organizationId, o.id), eq(platformCredentials.provider, "amazon"))).limit(1);
    if (!row) continue;
    const refreshToken = decryptSecret(row.refreshToken);
    if (!refreshToken) continue;
    cred = { refreshToken, sellerId: row.sellerId, marketplaceId: row.marketplaceId, region: row.region };
    console.log(`using ${o.name}'s Amazon credential (marketplace ${row.marketplaceId})`);
    break;
  }
  if (!cred) { console.error("no usable Amazon credential"); process.exit(1); }

  const since = new Date(Date.now() - days * 864e5).toISOString();
  const qs = new URLSearchParams({ postedAfter: since, marketplaceId: cred.marketplaceId ?? "" });
  const res = await spJson<{ payload?: { transactions?: unknown[]; nextToken?: string }; transactions?: unknown[] }>(
    cred, `/finances/2024-06-19/transactions?${qs}`);

  // The envelope has moved between SP-API versions; take whichever shape came back.
  const txns = (res.payload?.transactions ?? res.transactions ?? []) as Record<string, unknown>[];
  console.log(`\n${txns.length} transactions in the last ${days} days\n`);
  if (!txns.length) { console.log(JSON.stringify(res, null, 2).slice(0, 4000)); process.exit(0); }

  // Two in full — enough to see every nested field — then a one-line index of the rest.
  console.log("── first two, verbatim ──────────────────────────────────");
  console.log(JSON.stringify(txns.slice(0, 2), null, 2));

  console.log("\n── all of them, one line each ───────────────────────────");
  for (const t of txns) {
    const id = (t.relatedIdentifiers as { relatedIdentifierName?: string; relatedIdentifierValue?: string }[] | undefined)
      ?.find((r) => /order/i.test(r.relatedIdentifierName ?? ""))?.relatedIdentifierValue ?? "—";
    const amt = t.totalAmount as { currencyAmount?: number; currencyCode?: string } | undefined;
    console.log(`  ${String(t.postedDate ?? "").slice(0, 10)}  ${String(t.transactionType ?? "").padEnd(18)} ${String(t.transactionStatus ?? "").padEnd(18)} ${id.padEnd(22)} ${String(amt?.currencyAmount ?? "").padStart(10)}  txn=${String(t.transactionId ?? "").slice(0, 12)}`);
  }

  // The distinct keys across every breakdown item — this is what the schema has to hold.
  const kinds = new Set<string>();
  for (const t of txns) {
    const walk = (items: unknown[]) => {
      for (const it of items as Record<string, unknown>[]) {
        if (typeof it?.breakdownType === "string") kinds.add(it.breakdownType);
        if (Array.isArray(it?.breakdowns)) walk(it.breakdowns as unknown[]);
      }
    };
    if (Array.isArray(t.breakdowns)) walk(t.breakdowns as unknown[]);
  }
  console.log(`\n── breakdown types seen ─────────────────────────────────\n  ${[...kinds].sort().join("\n  ") || "(none)"}`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
