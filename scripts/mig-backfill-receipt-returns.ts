/**
 * One-off, idempotent: convert legacy whole-receipt REVERSALS (old reverseReceiptAction)
 * into proper purchaseReturns documents so they show as linked sub-rows under the receipt.
 *
 * The old reverse already posted the SAME GL (Dr 2103 / Cr 1104) + stock OUT as a receipt
 * return does, so we only RE-POINT those existing entries to source/reference PURCHASE_RETURN
 * (no new GL — trial balance is identical) and drop the REVERSED status.
 */
import { db } from "@/lib/db";
import { sql, and, eq, inArray } from "drizzle-orm";
import { purchaseReceipts, purchaseReturns, purchaseReturnLines, accounts, journalEntries, journalEntryLines, stockMovements } from "@/db/schema";
import { nextDocumentNumber } from "@/lib/erp/sequence";

const round2 = (n: number) => Math.round(n * 100) / 100;

async function trialBalance(orgId: string) {
  const r = await db.execute<{ d: string; c: string }>(sql`
    SELECT coalesce(sum(jl.debit),0) d, coalesce(sum(jl.credit),0) c
    FROM journal_entry_lines jl JOIN journal_entries je ON je.id = jl.journal_entry_id
    WHERE je.organization_id = ${orgId}`);
  return { d: Number(r.rows[0].d), c: Number(r.rows[0].c) };
}

async function main() {
  const reversed = await db.select().from(purchaseReceipts).where(eq(purchaseReceipts.status, "REVERSED"));
  if (reversed.length === 0) { console.log("nothing to migrate"); process.exit(0); }
  console.log(`found ${reversed.length} REVERSED receipt(s)`);

  for (const grn of reversed) {
    const orgId = grn.organizationId;
    if (!grn.supplierId) { console.log(`! ${grn.number}: no supplier — skip`); continue; }

    // already has a return? skip (idempotent)
    const [existing] = await db.select({ id: purchaseReturns.id }).from(purchaseReturns).where(eq(purchaseReturns.purchaseReceiptId, grn.id)).limit(1);
    if (existing) { console.log(`= ${grn.number}: already has a return — skip`); continue; }

    // reversed quantities + receipt unit costs
    const rev = await db.select({ itemId: stockMovements.itemId, q: stockMovements.quantity, wh: stockMovements.warehouseId })
      .from(stockMovements).where(and(eq(stockMovements.referenceId, grn.id), eq(stockMovements.referenceType, "GOODS_RECEIPT_REVERSE")));
    if (rev.length === 0) { console.log(`! ${grn.number}: no reverse movements — skip`); continue; }
    const inMv = await db.select({ itemId: stockMovements.itemId, q: stockMovements.quantity, c: stockMovements.unitCost })
      .from(stockMovements).where(and(eq(stockMovements.referenceId, grn.id), eq(stockMovements.referenceType, "GOODS_RECEIPT")));
    const cost = new Map<string, { v: number; q: number }>();
    for (const m of inMv) { const x = cost.get(m.itemId) ?? { v: 0, q: 0 }; x.v += Number(m.q) * Number(m.c); x.q += Number(m.q); cost.set(m.itemId, x); }
    const qByItem = new Map<string, number>();
    for (const m of rev) qByItem.set(m.itemId, (qByItem.get(m.itemId) ?? 0) + Number(m.q));
    const lines = [...qByItem.entries()].map(([itemId, q]) => {
      const c = cost.get(itemId);
      return { itemId, quantity: q, unitPrice: c && c.q > 0 ? round2(c.v / c.q) : 0 };
    });
    const net = round2(lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0));

    // verify the legacy reverse entry uses Dr 2103 / Cr 1104 (same as a receipt return)
    const accs = await db.select({ code: accounts.code, id: accounts.id }).from(accounts)
      .where(and(eq(accounts.organizationId, orgId), inArray(accounts.code, ["1104", "2103"])));
    const A = Object.fromEntries(accs.map((a) => [a.code, a.id]));
    const revEntry = await db.select({ id: journalEntries.id }).from(journalEntries)
      .where(and(eq(journalEntries.organizationId, orgId), eq(journalEntries.sourceType, "GOODS_RECEIPT_REVERSE"), eq(journalEntries.sourceId, grn.id)));
    for (const e of revEntry) {
      const jl = await db.select({ acc: journalEntryLines.accountId, d: journalEntryLines.debit, c: journalEntryLines.credit }).from(journalEntryLines).where(eq(journalEntryLines.journalEntryId, e.id));
      const debits = jl.filter((l) => Number(l.d) > 0).map((l) => l.acc);
      const credits = jl.filter((l) => Number(l.c) > 0).map((l) => l.acc);
      if (!debits.every((a) => a === A["2103"]) || !credits.every((a) => a === A["1104"])) {
        console.log(`! ${grn.number}: legacy entry accounts ≠ Dr2103/Cr1104 — skip (manual review)`);
        continue;
      }
    }

    const tbBefore = await trialBalance(orgId);
    const number = await nextDocumentNumber(db, orgId, "PR", new Date(grn.date).getFullYear());

    await db.transaction(async (tx) => {
      const [ret] = await tx.insert(purchaseReturns).values({
        organizationId: orgId, number, date: new Date(grn.date), status: "POSTED",
        supplierId: grn.supplierId!, warehouseId: grn.warehouseId, purchaseReceiptId: grn.id, purchaseOrderId: grn.purchaseOrderId,
        totalAmount: String(net), notes: "ترحيل: عكس استلام قديم",
      }).returning({ id: purchaseReturns.id });
      await tx.insert(purchaseReturnLines).values(lines.map((l) => ({
        purchaseReturnId: ret.id, itemId: l.itemId, quantity: String(l.quantity), unitPrice: String(l.unitPrice), totalAmount: String(round2(l.quantity * l.unitPrice)),
      })));
      // re-point the existing GL + stock to the new return document
      await tx.execute(sql`UPDATE journal_entries SET source_type='PURCHASE_RETURN', source_id=${ret.id} WHERE organization_id=${orgId} AND source_type='GOODS_RECEIPT_REVERSE' AND source_id=${grn.id}`);
      await tx.execute(sql`UPDATE stock_movements SET reference_type='PURCHASE_RETURN', reference_id=${ret.id} WHERE organization_id=${orgId} AND reference_type='GOODS_RECEIPT_REVERSE' AND reference_id=${grn.id}`);
      // drop REVERSED → back to its natural state
      await tx.update(purchaseReceipts).set({ status: grn.purchaseInvoiceId ? "INVOICED" : "RECEIVED" }).where(eq(purchaseReceipts.id, grn.id));
    });

    const tbAfter = await trialBalance(orgId);
    const balOk = round2(tbBefore.d) === round2(tbAfter.d) && round2(tbBefore.c) === round2(tbAfter.c) && round2(tbAfter.d) === round2(tbAfter.c);
    console.log(`${balOk ? "✅" : "❌"} ${grn.number} → ${number} (qty ${lines.reduce((s, l) => s + l.quantity, 0)}, net ${net}); status→${grn.purchaseInvoiceId ? "INVOICED" : "RECEIVED"}; TB ${round2(tbAfter.d)}==${round2(tbAfter.c)} (was ${round2(tbBefore.d)})`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
