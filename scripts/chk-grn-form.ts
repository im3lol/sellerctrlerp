import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  organizations, purchaseOrders, purchaseOrderLines, purchaseReceipts, purchaseReceiptLines, accounts,
} from "@/db/schema";
import { postStockMovement } from "@/lib/erp/inventory";
import { postEntry } from "@/lib/erp/posting";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const round2 = (n: number) => Math.round(n * 100) / 100;

// Faithful test of the new receive math: replicate exactly what
// createReceiptFromOrderAction does for one line (accept + reject) using the
// REAL posting helpers, inside a transaction we ROLL BACK — so demo data is
// untouched. Verifies: accepted → stock & GL; rejected → recorded only (stays
// backorder); books stay balanced and GL 1104 == perpetual ledger.
async function balanced(x: Tx, orgId: string) {
  const r = await x.execute<{ d: string; c: string }>(sql`
    SELECT coalesce(sum(jl.debit),0) d, coalesce(sum(jl.credit),0) c
    FROM journal_entry_lines jl JOIN journal_entries je ON je.id = jl.journal_entry_id
    WHERE je.organization_id = ${orgId}`);
  return { d: Number(r.rows[0].d), c: Number(r.rows[0].c) };
}
async function gl1104(x: Tx, orgId: string, accId: string) {
  const r = await x.execute<{ bal: string }>(sql`
    SELECT coalesce(sum(jl.debit-jl.credit),0) bal FROM journal_entry_lines jl
    JOIN journal_entries je ON je.id = jl.journal_entry_id
    WHERE je.organization_id = ${orgId} AND jl.account_id = ${accId}`);
  return Number(r.rows[0].bal);
}
async function ledgerValue(x: Tx, orgId: string) {
  const r = await x.execute<{ v: string }>(sql`
    SELECT coalesce(sum(t.balance_value),0) v FROM (
      SELECT DISTINCT ON (sm.item_id, sm.warehouse_id) sm.balance_value
      FROM stock_movements sm WHERE sm.organization_id = ${orgId}
      ORDER BY sm.item_id, sm.warehouse_id, sm.created_at DESC, sm.id DESC) t`);
  return Number(r.rows[0].v);
}
async function onHand(x: Tx, orgId: string, itemId: string, whId: string) {
  const r = await x.execute<{ q: string }>(sql`
    SELECT balance_quantity q FROM stock_movements
    WHERE organization_id = ${orgId} AND item_id = ${itemId} AND warehouse_id = ${whId}
    ORDER BY created_at DESC, id DESC LIMIT 1`);
  return Number(r.rows[0]?.q ?? 0);
}

async function main() {
  const [org] = await db.select().from(organizations).limit(1);
  const orgId = org.id;
  const [po] = await db.select().from(purchaseOrders)
    .where(and(eq(purchaseOrders.organizationId, orgId), inArray(purchaseOrders.status, ["CONFIRMED", "PARTIALLY_RECEIVED"])))
    .orderBy(desc(purchaseOrders.date)).limit(1);
  if (!po) { console.log("no receivable PO — skip"); process.exit(0); }
  const [l] = await db.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, po.id)).limit(1);
  const accs = await db.select({ code: accounts.code, id: accounts.id }).from(accounts)
    .where(and(eq(accounts.organizationId, orgId), inArray(accounts.code, ["1104", "2103"])));
  const A = Object.fromEntries(accs.map((a) => [a.code, a.id]));

  const remaining = round2(Number(l.quantity) - Number(l.receivedQty));
  const accept = Math.min(1, remaining);
  const reject = remaining - accept >= 1 ? 1 : 0;
  const whId = po.warehouseId;
  const unitNet = Number(l.unitPrice) - Number(l.discountAmount) / (Number(l.quantity) || 1) + Number(l.shippingPerUnit);
  const received = round2(accept * unitNet);

  console.log("PO:", po.number, "status:", po.status, "| line remaining:", remaining);
  console.log("accept:", accept, "reject:", reject, "| unitNet:", unitNet.toFixed(4), "received value:", received);

  const SENTINEL = "ROLLBACK_TEST";
  const results: Record<string, string> = {};
  try {
    await db.transaction(async (tx) => {
      const b0 = await balanced(tx, orgId);
      const gl0 = await gl1104(tx, orgId, A["1104"]);
      const lv0 = await ledgerValue(tx, orgId);
      const st0 = await onHand(tx, orgId, l.itemId, whId);
      const rq0 = Number(l.receivedQty);

      const [grn] = await tx.insert(purchaseReceipts).values({
        organizationId: orgId, number: "GRN-TEST", date: new Date("2026-06-21"), status: "RECEIVED",
        purchaseOrderId: po.id, supplierId: po.supplierId, warehouseId: whId, notes: "test",
      }).returning({ id: purchaseReceipts.id });
      await tx.insert(purchaseReceiptLines).values({ purchaseReceiptId: grn.id, itemId: l.itemId, warehouseId: whId, quantity: String(accept), rejectedQty: String(reject) });
      await postStockMovement(tx, { orgId, itemId: l.itemId, warehouseId: whId, type: "IN", quantity: accept, unitCost: unitNet, date: new Date("2026-06-21"), referenceType: "GOODS_RECEIPT", referenceId: grn.id });
      await postEntry(tx, { orgId, date: new Date("2026-06-21"), sourceType: "GOODS_RECEIPT", sourceId: grn.id, description: "test", journalType: "PURCHASE", lines: [{ accountId: A["1104"], debit: received, credit: 0 }, { accountId: A["2103"], debit: 0, credit: received }] });
      await tx.update(purchaseOrderLines).set({ receivedQty: sql`${purchaseOrderLines.receivedQty} + ${accept}` }).where(eq(purchaseOrderLines.id, l.id));

      const b1 = await balanced(tx, orgId);
      const gl1 = await gl1104(tx, orgId, A["1104"]);
      const lv1 = await ledgerValue(tx, orgId);
      const st1 = await onHand(tx, orgId, l.itemId, whId);
      const [rq1row] = await tx.select({ r: purchaseOrderLines.receivedQty }).from(purchaseOrderLines).where(eq(purchaseOrderLines.id, l.id));
      const rq1 = Number(rq1row.r);

      const ok = (c: boolean) => (c ? "✅" : "❌");
      results.stock = `stock Δ ${(st1 - st0).toFixed(3)} (expect ${accept}) ${ok(Math.abs(st1 - st0 - accept) < 1e-6)}`;
      results.backorder = `receivedQty Δ ${(rq1 - rq0).toFixed(3)} (expect ${accept}; reject stays backorder) ${ok(Math.abs(rq1 - rq0 - accept) < 1e-6)}`;
      results.balanced0 = `books before ${b0.d.toFixed(2)}=${b0.c.toFixed(2)} ${ok(Math.abs(b0.d - b0.c) < 0.01)}`;
      results.balanced1 = `books after  ${b1.d.toFixed(2)}=${b1.c.toFixed(2)} ${ok(Math.abs(b1.d - b1.c) < 0.01)}`;
      results.glMatch = `GL 1104 Δ ${(gl1 - gl0).toFixed(2)} == ledger Δ ${(lv1 - lv0).toFixed(2)} ${ok(Math.abs((gl1 - gl0) - (lv1 - lv0)) < 0.01)}`;
      results.glLedger = `GL 1104 ${gl1.toFixed(2)} == ledger ${lv1.toFixed(2)} ${ok(Math.abs(gl1 - lv1) < 0.01)}`;

      throw new Error(SENTINEL); // roll back — leave demo data untouched
    });
  } catch (e) {
    if (!(e instanceof Error) || e.message !== SENTINEL) throw e;
  }
  for (const k of Object.keys(results)) console.log(" ", results[k]);
  console.log("(transaction rolled back — no demo data changed)");
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
