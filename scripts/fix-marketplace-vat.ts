/**
 * Undo the phantom output VAT on marketplace orders.
 *
 * The connector ingest used to assume every marketplace price was VAT-inclusive and carved
 * the org's rate out of every order — so a 999.00 Amazon order was recorded as 876.32 plus
 * 122.68 of output VAT that nobody owed. `sales_platforms.prices_include_vat` now gates
 * that (off by default); this repairs what was already written.
 *
 * What it does, per org:
 *   1. Marketplace sales orders carrying tax → unit price back to the gross, tax 0.
 *   2. The invoices raised from them → the same.
 *   3. ONE dated correcting entry for the tax that actually reached the ledger:
 *        Dr 2102 output VAT / Cr 4101 sales
 *
 * What it deliberately does NOT touch: document totals, customer balances, receipts,
 * settlements, stock, or the original journal entries. Only the revenue/tax split inside
 * an unchanged total moves — which is why marketplace settlement reconciliation is
 * unaffected.
 *
 * Preview by default. Pass --apply to write.
 *
 *   DATABASE_URL=... npx tsx --tsconfig tsconfig.script.json scripts/fix-marketplace-vat.ts
 *   DATABASE_URL=... npx tsx --tsconfig tsconfig.script.json scripts/fix-marketplace-vat.ts --apply
 */
import { and, eq, inArray, isNotNull, ne, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  organizations, salesOrders, salesOrderLines, salesInvoices, salesInvoiceLines, deliveryNotes,
} from "@/db/schema";
import { postEntry } from "@/lib/erp/posting";
import { resolveAccountIds } from "@/lib/erp/accounting-config";
import { round2 } from "@/lib/erp/money";

const APPLY = process.argv.includes("--apply");
const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Doc = {
  id: string; number: string; subtotal: string; taxAmount: string; totalAmount: string;
  discountAmount: string; shippingAmount: string; status: string;
};

/**
 * Fold a document's tax back into its subtotal. Returns null when the numbers don't add up
 * the way the importer wrote them — better to report a document than silently reshape one
 * this script doesn't understand.
 */
function fold(d: Doc) {
  const tax = Number(d.taxAmount);
  const subtotal = round2(Number(d.subtotal) + tax);
  const total = Number(d.totalAmount);
  if (!(tax > 0)) return null;
  // The whole safety of this repair rests on the total not moving. Check the identity the
  // document is supposed to satisfy, and refuse anything that doesn't.
  const rebuilt = round2(subtotal + Number(d.shippingAmount ?? 0) - Number(d.discountAmount ?? 0));
  if (Math.abs(rebuilt - total) > 0.01) {
    console.log(`    !! ${d.number}: ${money(rebuilt)} ≠ total ${money(total)} — left alone`);
    return null;
  }
  return { subtotal, tax: 0, total };
}

async function main() {
  const orgs = await db.select({ id: organizations.id, name: organizations.nameAr }).from(organizations);
  let touchedOrders = 0, touchedInvoices = 0, corrected = 0;

  for (const org of orgs) {
    // Marketplace orders only: `channel` is null for anything typed in by hand, and a
    // hand-entered order's VAT may be perfectly real.
    const orders = await db.select({
      id: salesOrders.id, number: salesOrders.number, subtotal: salesOrders.subtotal,
      taxAmount: salesOrders.taxAmount, totalAmount: salesOrders.totalAmount, status: salesOrders.status,
      discountAmount: salesOrders.discountAmount, shippingAmount: salesOrders.shippingAmount,
    }).from(salesOrders).where(and(
      eq(salesOrders.organizationId, org.id),
      isNotNull(salesOrders.channel),
      ne(salesOrders.taxAmount, "0"),
    ));
    if (orders.length === 0) continue;

    const orderIds = orders.map((o) => o.id);
    // An invoice reaches its order either directly or through the delivery note it was
    // raised from — the marketplace cycle uses the second, and only the second, so
    // matching on sales_order_id alone finds nothing.
    const invoices = await db.selectDistinct({
      id: salesInvoices.id, number: salesInvoices.number, subtotal: salesInvoices.subtotal,
      taxAmount: salesInvoices.taxAmount, totalAmount: salesInvoices.totalAmount, status: salesInvoices.status,
      discountAmount: salesInvoices.discountAmount, shippingAmount: salesInvoices.shippingAmount,
    }).from(salesInvoices)
      .leftJoin(deliveryNotes, eq(deliveryNotes.id, salesInvoices.deliveryNoteId))
      .where(and(
        eq(salesInvoices.organizationId, org.id),
        ne(salesInvoices.taxAmount, "0"),
        or(
          inArray(salesInvoices.salesOrderId, orderIds),
          inArray(deliveryNotes.salesOrderId, orderIds),
        ),
      ));

    // Only tax that actually reached the ledger needs a correcting entry. A draft or
    // cancelled invoice never posted anything, so there is nothing to move for it.
    const postedTax = round2(invoices
      .filter((i) => i.status !== "DRAFT" && i.status !== "CANCELLED")
      .reduce((s, i) => s + Number(i.taxAmount), 0));

    console.log(`\n${org.name}`);
    console.log(`  orders   ${orders.length} carrying ${money(orders.reduce((s, o) => s + Number(o.taxAmount), 0))} tax`);
    console.log(`  invoices ${invoices.length} carrying ${money(invoices.reduce((s, i) => s + Number(i.taxAmount), 0))} tax (${money(postedTax)} of it posted)`);
    for (const o of orders) {
      const f = fold(o);
      if (f) console.log(`    ${o.number} [${o.status}]  ${money(Number(o.subtotal))} + ${money(Number(o.taxAmount))} → ${money(f.subtotal)} + 0.00   (total ${money(f.total)} unchanged)`);
    }

    if (!APPLY) continue;

    const A = await resolveAccountIds(org.id, ["2102", "4101"]);
    if (postedTax > 0 && (!A["2102"] || !A["4101"])) {
      console.log("  !! 2102/4101 missing — cannot post the correction; skipping this org");
      continue;
    }

    await db.transaction(async (tx) => {
      for (const o of orders) {
        const f = fold(o);
        if (!f) continue;
        // A marketplace line's totalAmount is the gross the buyer paid — put the unit price
        // back to it. Guard on discount: these lines carry none, and if one ever did the
        // arithmetic below would be wrong, so leave it and say so.
        const lines = await tx.select({ id: salesOrderLines.id, qty: salesOrderLines.quantity, total: salesOrderLines.totalAmount, discount: salesOrderLines.discountAmount })
          .from(salesOrderLines).where(eq(salesOrderLines.salesOrderId, o.id));
        for (const l of lines) {
          if (Number(l.discount) !== 0) { console.log(`    !! ${o.number}: line has a discount — left alone`); continue; }
          const qty = Number(l.qty);
          await tx.update(salesOrderLines).set({
            unitPrice: String(qty > 0 ? round2(Number(l.total) / qty) : Number(l.total)),
            taxAmount: "0",
          }).where(eq(salesOrderLines.id, l.id));
        }
        await tx.update(salesOrders).set({ subtotal: String(f.subtotal), taxAmount: "0", updatedAt: new Date() })
          .where(eq(salesOrders.id, o.id));
        touchedOrders++;
      }

      for (const i of invoices) {
        const f = fold(i);
        if (!f) continue;
        const lines = await tx.select({ id: salesInvoiceLines.id, qty: salesInvoiceLines.quantity, total: salesInvoiceLines.totalAmount, discount: salesInvoiceLines.discountAmount })
          .from(salesInvoiceLines).where(eq(salesInvoiceLines.salesInvoiceId, i.id));
        for (const l of lines) {
          if (Number(l.discount) !== 0) { console.log(`    !! ${i.number}: line has a discount — left alone`); continue; }
          const qty = Number(l.qty);
          await tx.update(salesInvoiceLines).set({
            unitPrice: String(qty > 0 ? round2(Number(l.total) / qty) : Number(l.total)),
            taxAmount: "0",
          }).where(eq(salesInvoiceLines.id, l.id));
        }
        await tx.update(salesInvoices).set({ subtotal: String(f.subtotal), taxAmount: "0", updatedAt: new Date() })
          .where(eq(salesInvoices.id, i.id));
        touchedInvoices++;
      }

      // The ledger side: one dated entry, leaving every original posting untouched. This is
      // what an accountant would write, and it stays visible in the journal for review.
      if (postedTax > 0) {
        await postEntry(tx, {
          orgId: org.id, date: new Date(), sourceType: "MANUAL", sourceId: crypto.randomUUID(),
          description: "تصحيح ضريبة مخرجات سُجّلت خطأً على أوامر المنصات",
          journalType: "GENERAL",
          lines: [
            { accountId: A["2102"], debit: postedTax, credit: 0, description: "عكس ضريبة مخرجات أوامر المنصات" },
            { accountId: A["4101"], debit: 0, credit: postedTax, description: "إيراد مبيعات كان مُدرجاً كضريبة" },
          ],
        });
        corrected = round2(corrected + postedTax);
      }
    });

    // Prove it landed rather than trusting the writes above.
    const [left] = await db.select({ n: sql<number>`count(*)::int` }).from(salesOrders)
      .where(and(eq(salesOrders.organizationId, org.id), isNotNull(salesOrders.channel), ne(salesOrders.taxAmount, "0")));
    console.log(`  → marketplace orders still carrying tax: ${left?.n ?? "?"}`);
  }

  console.log(APPLY
    ? `\napplied — ${touchedOrders} orders, ${touchedInvoices} invoices, ${money(corrected)} moved from output VAT to sales`
    : `\npreview only — nothing written. Re-run with --apply to make these changes.`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
