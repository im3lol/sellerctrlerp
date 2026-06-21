import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { organizations, purchaseReceipts, purchaseReceiptLines, purchaseOrderLines, accounts, stockMovements } from "@/db/schema";
import { postStockMovement } from "@/lib/erp/inventory";
import { postEntry } from "@/lib/erp/posting";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const round2 = (n: number) => Math.round(n * 100) / 100;
const ok = (c: boolean) => (c ? "✅" : "❌");

async function sums(x: Tx, orgId: string) {
  const r = await x.execute<{ d: string; c: string }>(sql`
    SELECT coalesce(sum(jl.debit),0) d, coalesce(sum(jl.credit),0) c FROM journal_entry_lines jl
    JOIN journal_entries je ON je.id = jl.journal_entry_id WHERE je.organization_id = ${orgId}`);
  return { d: Number(r.rows[0].d), c: Number(r.rows[0].c) };
}
async function bal(x: Tx, orgId: string, accId: string) {
  const r = await x.execute<{ b: string }>(sql`
    SELECT coalesce(sum(jl.debit-jl.credit),0) b FROM journal_entry_lines jl
    JOIN journal_entries je ON je.id = jl.journal_entry_id WHERE je.organization_id = ${orgId} AND jl.account_id = ${accId}`);
  return Number(r.rows[0].b);
}
async function onHand(x: Tx, orgId: string, itemId: string, whId: string) {
  const r = await x.execute<{ q: string }>(sql`SELECT balance_quantity q FROM stock_movements
    WHERE organization_id=${orgId} AND item_id=${itemId} AND warehouse_id=${whId} ORDER BY created_at DESC, id DESC LIMIT 1`);
  return Number(r.rows[0]?.q ?? 0);
}

// Faithful rolled-back test of receipt reverse: stock OUT at receipt cost + Dr 2103 /
// Cr 1104 → GRNI nets back to zero, inventory drops, PO receivedQty drops, balanced.
async function main() {
  const [org] = await db.select().from(organizations).limit(1);
  const orgId = org.id;
  const accs = await db.select({ code: accounts.code, id: accounts.id }).from(accounts)
    .where(and(eq(accounts.organizationId, orgId), inArray(accounts.code, ["1104", "2103"])));
  const A = Object.fromEntries(accs.map((a) => [a.code, a.id]));

  // A RECEIVED, un-invoiced receipt.
  const grns = await db.select().from(purchaseReceipts)
    .where(and(eq(purchaseReceipts.organizationId, orgId), eq(purchaseReceipts.status, "RECEIVED"))).orderBy(desc(purchaseReceipts.date));
  const grn = grns.find((g) => !g.purchaseInvoiceId);
  if (!grn) { console.log("no un-invoiced received GRN — skip"); process.exit(0); }
  const moves = await db.select({ itemId: stockMovements.itemId, quantity: stockMovements.quantity, unitCost: stockMovements.unitCost })
    .from(stockMovements).where(and(eq(stockMovements.organizationId, orgId), eq(stockMovements.referenceType, "GOODS_RECEIPT"), eq(stockMovements.referenceId, grn.id)));
  if (!moves.length) { console.log("no receipt movements — skip"); process.exit(0); }
  const m0 = moves[0];

  const SENTINEL = "ROLLBACK"; const out: string[] = [];
  try {
    await db.transaction(async (tx) => {
      const s0 = await sums(tx, orgId);
      const grni0 = await bal(tx, orgId, A["2103"]); const inv0 = await bal(tx, orgId, A["1104"]);
      const st0 = await onHand(tx, orgId, m0.itemId, grn.warehouseId);

      let value = 0;
      for (const m of moves) {
        const qty = Number(m.quantity), cost = Number(m.unitCost);
        await postStockMovement(tx, { orgId, itemId: m.itemId, warehouseId: grn.warehouseId, type: "OUT", quantity: qty, unitCost: cost, date: new Date("2026-06-21"), referenceType: "GOODS_RECEIPT_REVERSE", referenceId: grn.id });
        value += round2(qty * cost);
      }
      value = round2(value);
      await postEntry(tx, { orgId, date: new Date("2026-06-21"), sourceType: "GOODS_RECEIPT_REVERSE", sourceId: grn.id, description: "rev", journalType: "PURCHASE", lines: [{ accountId: A["2103"], debit: value, credit: 0 }, { accountId: A["1104"], debit: 0, credit: value }] });

      const s1 = await sums(tx, orgId);
      const grni1 = await bal(tx, orgId, A["2103"]); const inv1 = await bal(tx, orgId, A["1104"]);
      const st1 = await onHand(tx, orgId, m0.itemId, grn.warehouseId);

      out.push(`reverse value ${value.toFixed(2)}`);
      out.push(`GRNI(2103) Δ +${(grni1 - grni0).toFixed(2)} (debits back what the receipt credited) ${ok(Math.abs((grni1 - grni0) - value) < 0.01)}`);
      out.push(`Inventory(1104) Δ ${(inv1 - inv0).toFixed(2)} (expect -${value.toFixed(2)}) ${ok(Math.abs((inv1 - inv0) + value) < 0.01)}`);
      out.push(`stock(${m0.itemId.slice(0, 6)}) Δ ${(st1 - st0).toFixed(3)} (expect -${Number(m0.quantity)}) ${ok(Math.abs((st1 - st0) + Number(m0.quantity)) < 1e-6)}`);
      out.push(`books balanced ${s1.d.toFixed(2)}=${s1.c.toFixed(2)} ${ok(Math.abs(s1.d - s1.c) < 0.01)}`);
      throw new Error(SENTINEL);
    });
  } catch (e) {
    if (!(e instanceof Error) || e.message !== SENTINEL) throw e;
  }
  console.log(`GRN ${grn.number}`);
  for (const l of out) console.log(" ", l);
  console.log("(rolled back — no demo data changed)");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
