/**
 * Reconcile stored marketplace order totals against what the channel actually charged.
 *
 * The importer used to rebuild an order's total from ItemPrice + ShippingPrice minus the
 * two promotion fields it knew about. Amazon also reduces via ShippingDiscount, which was
 * never read, so a free-shipping waiver left the order — and its invoice, its revenue and
 * the customer's balance — overstated. The mapper now takes Amazon's OrderTotal as the
 * authority; this repairs the documents raised before that.
 *
 * UNLIKE scripts/fix-marketplace-vat.ts, this MOVES MONEY. That one folded tax back into
 * the price and left every total standing. Here the total itself was wrong, so correcting
 * it reduces revenue, the invoice's balance due, and the customer's receivable. Each
 * correction posts a dated entry:
 *
 *     Dr 4101 المبيعات        (revenue that never happened)
 *         Cr 1103 العملاء     (a receivable that was never owed)
 *
 * Preview by default. Pass --apply to write.
 *
 *   DATABASE_URL=... npx tsx --tsconfig tsconfig.script.json scripts/reconcile-marketplace-totals.ts SO-2026-0017=3320
 *   … scripts/reconcile-marketplace-totals.ts SO-2026-0017=3320 --apply
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  organizations, salesOrders, salesInvoices,
  deliveryNotes, customers,
} from "@/db/schema";
import { postEntry } from "@/lib/erp/posting";
import { resolveAccountIds } from "@/lib/erp/accounting-config";
import { round2 } from "@/lib/erp/money";

const APPLY = process.argv.includes("--apply");
const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** `SO-2026-0017=3320` → the true total Amazon reports for that order. */
const targets = new Map<string, number>();
for (const a of process.argv.slice(2)) {
  const m = a.match(/^(\S+)=([\d.]+)$/);
  if (m) targets.set(m[1], Number(m[2]));
}
if (targets.size === 0) {
  console.error("usage: … reconcile-marketplace-totals.ts SO-2026-0017=3320 [more…] [--apply]");
  process.exit(1);
}

async function main() {
  const orgs = await db.select({ id: organizations.id, name: organizations.nameAr }).from(organizations);
  let posted = 0;

  for (const org of orgs) {
    for (const [number, trueTotal] of targets) {
      const [so] = await db.select().from(salesOrders)
        .where(and(eq(salesOrders.organizationId, org.id), eq(salesOrders.number, number))).limit(1);
      if (!so) continue;

      const stored = Number(so.totalAmount);
      const delta = round2(stored - trueTotal); // > 0 = we booked too much
      console.log(`\n${number} [${so.status}]  stored ${money(stored)} → Amazon ${money(trueTotal)}  = ${money(delta)} overstated`);
      if (Math.abs(delta) < 0.01) { console.log("  already correct — nothing to do"); continue; }
      if (delta < 0) { console.log("  !! stored total is LOWER than Amazon's — not handled here, look at it by hand"); continue; }

      // The overstatement was a reduction Amazon applied that we failed to record, so it
      // belongs in the order's discount — that keeps subtotal + shipping − discount = total
      // standing, which every downstream document depends on.
      const newDiscount = round2(Number(so.discountAmount) + delta);
      console.log(`  discount ${money(Number(so.discountAmount))} → ${money(newDiscount)}, total → ${money(trueTotal)}`);

      const invoices = await db.selectDistinct({
        id: salesInvoices.id, number: salesInvoices.number, status: salesInvoices.status,
        total: salesInvoices.totalAmount, discount: salesInvoices.discountAmount,
        paid: salesInvoices.paidAmount, balanceDue: salesInvoices.balanceDue,
        customerId: salesInvoices.customerId,
      }).from(salesInvoices)
        .leftJoin(deliveryNotes, eq(deliveryNotes.id, salesInvoices.deliveryNoteId))
        .where(and(eq(salesInvoices.organizationId, org.id), eq(deliveryNotes.salesOrderId, so.id)));

      for (const inv of invoices) {
        console.log(`  invoice ${inv.number} [${inv.status}]  ${money(Number(inv.total))} → ${money(round2(Number(inv.total) - delta))}` +
          `  · balance ${money(Number(inv.balanceDue))} → ${money(round2(Number(inv.balanceDue) - delta))}`);
      }
      const live = invoices.filter((i) => i.status !== "DRAFT" && i.status !== "CANCELLED");
      if (live.length > 1) { console.log("  !! more than one posted invoice — not handled here"); continue; }

      if (!APPLY) continue;

      const A = await resolveAccountIds(org.id, ["4101", "1103"]);
      if (live.length && (!A["4101"] || !A["1103"])) { console.log("  !! 4101/1103 missing — skipping"); continue; }

      await db.transaction(async (tx) => {
        // The order: the reduction lands in the discount, lines keep their gross prices
        // (that IS what Amazon listed them at).
        await tx.update(salesOrders)
          .set({ discountAmount: String(newDiscount), totalAmount: String(trueTotal), updatedAt: new Date() })
          .where(eq(salesOrders.id, so.id));

        for (const inv of invoices) {
          const newTotal = round2(Number(inv.total) - delta);
          await tx.update(salesInvoices).set({
            discountAmount: String(round2(Number(inv.discount) + delta)),
            totalAmount: String(newTotal),
            // Money already received doesn't move; what's still owed does.
            balanceDue: String(round2(newTotal - Number(inv.paid))),
            updatedAt: new Date(),
          }).where(eq(salesInvoices.id, inv.id));

          if (inv.status === "DRAFT" || inv.status === "CANCELLED") continue;

          // Both representations of the debt, exactly as postSalesInvoiceAction moves them.
          // Decrement in SQL rather than writing back a value read earlier — a concurrent
          // payment would otherwise be clobbered.
          await tx.update(customers)
            .set({ balance: sql`${customers.balance} - ${delta}` })
            .where(eq(customers.id, inv.customerId));

          await postEntry(tx, {
            orgId: org.id, date: new Date(), sourceType: "MANUAL", sourceId: crypto.randomUUID(),
            description: `تصحيح إجمالي أمر منصة ${number} — خصم شحن لم يُسجَّل`,
            journalType: "SALES",
            lines: [
              { accountId: A["4101"], debit: delta, credit: 0, description: `عكس إيراد زائد ${inv.number}` },
              { accountId: A["1103"], debit: 0, credit: delta, description: `تخفيض مديونية العميل ${inv.number}` },
            ],
          });
          posted = round2(posted + delta);
        }
      });
      console.log("  ✓ corrected");
    }
  }

  console.log(APPLY ? `\napplied — ${money(posted)} of overstated revenue reversed` : "\npreview only — nothing written.");
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
