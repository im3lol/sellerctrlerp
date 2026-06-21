import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  organizations, purchaseReceipts, purchaseReceiptLines, purchaseOrderLines,
  accounts, stockMovements,
} from "@/db/schema";
import { postEntry } from "@/lib/erp/posting";
import { postStockMovement } from "@/lib/erp/inventory";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const round2 = (n: number) => Math.round(n * 100) / 100;
const ok = (c: boolean) => (c ? "✅" : "❌");

async function sums(x: Tx, orgId: string) {
  const r = await x.execute<{ d: string; c: string }>(sql`
    SELECT coalesce(sum(jl.debit),0) d, coalesce(sum(jl.credit),0) c
    FROM journal_entry_lines jl JOIN journal_entries je ON je.id = jl.journal_entry_id
    WHERE je.organization_id = ${orgId}`);
  return { d: Number(r.rows[0].d), c: Number(r.rows[0].c) };
}
async function acctBal(x: Tx, orgId: string, accId: string) {
  const r = await x.execute<{ b: string }>(sql`
    SELECT coalesce(sum(jl.debit-jl.credit),0) b FROM journal_entry_lines jl
    JOIN journal_entries je ON je.id = jl.journal_entry_id
    WHERE je.organization_id = ${orgId} AND jl.account_id = ${accId}`);
  return Number(r.rows[0].b);
}
async function ledger(x: Tx, orgId: string) {
  const r = await x.execute<{ v: string }>(sql`
    SELECT coalesce(sum(t.balance_value),0) v FROM (
      SELECT DISTINCT ON (sm.item_id, sm.warehouse_id) sm.balance_value
      FROM stock_movements sm WHERE sm.organization_id = ${orgId}
      ORDER BY sm.item_id, sm.warehouse_id, sm.created_at DESC, sm.id DESC) t`);
  return Number(r.rows[0].v);
}

// Faithful, rolled-back test of the receipt-return (stock-side) posting branch.
async function main() {
  const [org] = await db.select().from(organizations).limit(1);
  const orgId = org.id;
  const accs = await db.select({ code: accounts.code, id: accounts.id }).from(accounts)
    .where(and(eq(accounts.organizationId, orgId), inArray(accounts.code, ["1104", "2103"])));
  const A = Object.fromEntries(accs.map((a) => [a.code, a.id]));

  // Find a RECEIVED/INVOICED GRN that has stock movements (so we know the unit cost).
  const grns = await db.select().from(purchaseReceipts)
    .where(and(eq(purchaseReceipts.organizationId, orgId), inArray(purchaseReceipts.status, ["RECEIVED", "INVOICED"])));
  let chosen: { grn: typeof grns[number]; itemId: string; qty: number; cost: number } | null = null;
  for (const grn of grns) {
    const moves = await db.select({ itemId: stockMovements.itemId, q: stockMovements.quantity, c: stockMovements.unitCost })
      .from(stockMovements)
      .where(and(eq(stockMovements.organizationId, orgId), eq(stockMovements.referenceType, "GOODS_RECEIPT"), eq(stockMovements.referenceId, grn.id)));
    if (moves.length === 0) continue;
    const m = moves[0];
    const q = Math.min(Number(m.q), 1) || Number(m.q);
    if (q <= 0) continue;
    chosen = { grn, itemId: m.itemId, qty: round2(q), cost: Number(m.c) };
    break;
  }
  if (!chosen) { console.log("no eligible GRN with stock movements found"); process.exit(0); }
  const { grn, itemId, qty, cost } = chosen;
  const net = round2(qty * cost);
  console.log(`GRN ${grn.number} · item ${itemId.slice(0, 8)} · return qty ${qty} @ ${cost} = net ${net}`);

  try {
    await db.transaction(async (tx) => {
      const before = { s: await sums(tx, orgId), inv: await acctBal(tx, orgId, A["1104"]), grni: await acctBal(tx, orgId, A["2103"]), led: await ledger(tx, orgId) };

      // --- replicate confirmPurchaseReturnAction (receipt branch) ---
      await postStockMovement(tx, { orgId, itemId, warehouseId: grn.warehouseId, type: "OUT", quantity: qty, unitCost: cost, date: new Date(grn.date), referenceType: "PURCHASE_RETURN", referenceId: `TEST-${grn.id}`, reason: "test" });
      await postEntry(tx, { orgId, date: new Date(grn.date), sourceType: "PURCHASE_RETURN", sourceId: `TEST-${grn.id}`, description: "test receipt return", journalType: "PURCHASE", lines: [
        { accountId: A["2103"], debit: net, credit: 0, description: "GRNI" },
        { accountId: A["1104"], debit: 0, credit: net, description: "inventory out" },
      ] });
      if (grn.purchaseOrderId) {
        const [pol] = await tx.select({ id: purchaseOrderLines.id, recv: purchaseOrderLines.receivedQty }).from(purchaseOrderLines)
          .where(and(eq(purchaseOrderLines.purchaseOrderId, grn.purchaseOrderId), eq(purchaseOrderLines.itemId, itemId))).limit(1);
        if (pol) {
          const recvBefore = Number(pol.recv);
          await tx.update(purchaseOrderLines).set({ receivedQty: sql`GREATEST(0, ${purchaseOrderLines.receivedQty} - ${qty})` }).where(eq(purchaseOrderLines.id, pol.id));
          const [polAfter] = await tx.select({ recv: purchaseOrderLines.receivedQty }).from(purchaseOrderLines).where(eq(purchaseOrderLines.id, pol.id)).limit(1);
          console.log(`${ok(round2(Number(polAfter.recv)) === round2(recvBefore - qty))} PO receivedQty: ${recvBefore} → ${Number(polAfter.recv)} (expect ${round2(recvBefore - qty)})`);
        }
      }

      const after = { s: await sums(tx, orgId), inv: await acctBal(tx, orgId, A["1104"]), grni: await acctBal(tx, orgId, A["2103"]), led: await ledger(tx, orgId) };

      console.log(`${ok(round2(before.s.d) === round2(before.s.c))} books balanced BEFORE (${round2(before.s.d)} == ${round2(before.s.c)})`);
      console.log(`${ok(round2(after.s.d) === round2(after.s.c))} books balanced AFTER  (${round2(after.s.d)} == ${round2(after.s.c)})`);
      console.log(`${ok(round2(after.inv - before.inv) === -net)} GL 1104 (inventory) Δ = ${round2(after.inv - before.inv)} (expect ${-net})`);
      console.log(`${ok(round2(after.grni - before.grni) === net)} GL 2103 (GRNI) Δ = ${round2(after.grni - before.grni)} (expect ${net})`);
      console.log(`${ok(round2(after.led - before.led) === -net)} perpetual ledger Δ = ${round2(after.led - before.led)} (expect ${-net})`);

      throw new Error("ROLLBACK");
    });
  } catch (e) {
    if (e instanceof Error && e.message === "ROLLBACK") { console.log("— rolled back —"); process.exit(0); }
    console.error(e); process.exit(1);
  }
}
main();
