/**
 * One-off, idempotent: convert legacy whole-delivery REVERSALS (old reverseDeliveryAction)
 * into proper salesReturns documents so they show as linked sub-rows under the delivery.
 *
 * The old reverse already posted the SAME GL (Dr 1104 / Cr 5101) + stock IN as a delivery
 * return does, so we only RE-POINT those existing entries to source/reference SALES_RETURN
 * (no new GL — trial balance is identical) and drop the REVERSED status.
 */
import { db } from "@/lib/db";
import { sql, and, eq, inArray } from "drizzle-orm";
import { deliveryNotes, deliveryNoteLines, salesReturns, salesReturnLines, accounts, journalEntries, journalEntryLines, stockMovements } from "@/db/schema";
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
  const reversed = await db.select().from(deliveryNotes).where(eq(deliveryNotes.status, "REVERSED"));
  if (reversed.length === 0) { console.log("nothing to migrate"); process.exit(0); }
  console.log(`found ${reversed.length} REVERSED delivery(ies)`);

  for (const dn of reversed) {
    const orgId = dn.organizationId;
    if (!dn.customerId) { console.log(`! ${dn.number}: no customer — skip`); continue; }

    const [existing] = await db.select({ id: salesReturns.id }).from(salesReturns).where(eq(salesReturns.deliveryNoteId, dn.id)).limit(1);
    if (existing) { console.log(`= ${dn.number}: already has a return — skip`); continue; }

    const rev = await db.select({ itemId: stockMovements.itemId, q: stockMovements.quantity })
      .from(stockMovements).where(and(eq(stockMovements.referenceId, dn.id), eq(stockMovements.referenceType, "DELIVERY_REVERSE")));
    if (rev.length === 0) { console.log(`! ${dn.number}: no reverse movements — skip`); continue; }
    const outMv = await db.select({ itemId: stockMovements.itemId, q: stockMovements.quantity, c: stockMovements.unitCost })
      .from(stockMovements).where(and(eq(stockMovements.referenceId, dn.id), eq(stockMovements.referenceType, "DELIVERY")));
    const cost = new Map<string, { v: number; q: number }>();
    for (const m of outMv) { const x = cost.get(m.itemId) ?? { v: 0, q: 0 }; x.v += Number(m.q) * Number(m.c); x.q += Number(m.q); cost.set(m.itemId, x); }
    const qByItem = new Map<string, number>();
    for (const m of rev) qByItem.set(m.itemId, (qByItem.get(m.itemId) ?? 0) + Number(m.q));
    const lines = [...qByItem.entries()].map(([itemId, q]) => {
      const c = cost.get(itemId);
      return { itemId, quantity: q, unitPrice: c && c.q > 0 ? round2(c.v / c.q) : 0 };
    });
    const net = round2(lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0));

    // verify the legacy reverse entry uses Dr 1104 / Cr 5101 (same as a delivery return)
    const accs = await db.select({ code: accounts.code, id: accounts.id }).from(accounts)
      .where(and(eq(accounts.organizationId, orgId), inArray(accounts.code, ["1104", "5101"])));
    const A = Object.fromEntries(accs.map((a) => [a.code, a.id]));
    const revEntry = await db.select({ id: journalEntries.id }).from(journalEntries)
      .where(and(eq(journalEntries.organizationId, orgId), eq(journalEntries.sourceType, "DELIVERY_REVERSE"), eq(journalEntries.sourceId, dn.id)));
    let accountsOk = true;
    for (const e of revEntry) {
      const jl = await db.select({ acc: journalEntryLines.accountId, d: journalEntryLines.debit, c: journalEntryLines.credit }).from(journalEntryLines).where(eq(journalEntryLines.journalEntryId, e.id));
      const debits = jl.filter((l) => Number(l.d) > 0).map((l) => l.acc);
      const credits = jl.filter((l) => Number(l.c) > 0).map((l) => l.acc);
      if (!debits.every((a) => a === A["1104"]) || !credits.every((a) => a === A["5101"])) accountsOk = false;
    }
    if (!accountsOk) { console.log(`! ${dn.number}: legacy entry accounts ≠ Dr1104/Cr5101 — skip (manual review)`); continue; }

    const tbBefore = await trialBalance(orgId);
    const number = await nextDocumentNumber(db, orgId, "SR", new Date(dn.date).getFullYear());

    await db.transaction(async (tx) => {
      const [ret] = await tx.insert(salesReturns).values({
        organizationId: orgId, number, date: new Date(dn.date), status: "POSTED",
        customerId: dn.customerId!, warehouseId: dn.warehouseId, deliveryNoteId: dn.id, salesOrderId: dn.salesOrderId,
        totalAmount: String(net), notes: "ترحيل: عكس صرف قديم",
      }).returning({ id: salesReturns.id });
      await tx.insert(salesReturnLines).values(lines.map((l) => ({
        salesReturnId: ret.id, itemId: l.itemId, quantity: String(l.quantity), unitPrice: String(l.unitPrice), totalAmount: String(round2(l.quantity * l.unitPrice)),
      })));
      await tx.execute(sql`UPDATE journal_entries SET source_type='SALES_RETURN', source_id=${ret.id} WHERE organization_id=${orgId} AND source_type='DELIVERY_REVERSE' AND source_id=${dn.id}`);
      await tx.execute(sql`UPDATE stock_movements SET reference_type='SALES_RETURN', reference_id=${ret.id} WHERE organization_id=${orgId} AND reference_type='DELIVERY_REVERSE' AND reference_id=${dn.id}`);
      await tx.update(deliveryNotes).set({ status: dn.salesInvoiceId ? "INVOICED" : "DELIVERED" }).where(eq(deliveryNotes.id, dn.id));
    });

    const tbAfter = await trialBalance(orgId);
    const balOk = round2(tbBefore.d) === round2(tbAfter.d) && round2(tbBefore.c) === round2(tbAfter.c) && round2(tbAfter.d) === round2(tbAfter.c);
    console.log(`${balOk ? "✅" : "❌"} ${dn.number} → ${number} (qty ${lines.reduce((s, l) => s + l.quantity, 0)}, net ${net}); status→${dn.salesInvoiceId ? "INVOICED" : "DELIVERED"}; TB ${round2(tbAfter.d)}==${round2(tbAfter.c)} (was ${round2(tbBefore.d)})`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
