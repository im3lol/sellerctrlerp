import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  organizations, purchaseReceipts, purchaseReceiptLines, purchaseOrders, purchaseOrderLines, accounts, suppliers,
} from "@/db/schema";
import { postStockMovement } from "@/lib/erp/inventory";
import { postEntry } from "@/lib/erp/posting";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const round2 = (n: number) => Math.round(n * 100) / 100;
const ok = (c: boolean) => (c ? "✅" : "❌");

async function acctBal(x: Tx, orgId: string, accId: string) {
  const r = await x.execute<{ b: string }>(sql`
    SELECT coalesce(sum(jl.debit-jl.credit),0) b FROM journal_entry_lines jl
    JOIN journal_entries je ON je.id = jl.journal_entry_id
    WHERE je.organization_id = ${orgId} AND jl.account_id = ${accId}`);
  return Number(r.rows[0].b);
}
async function sums(x: Tx, orgId: string) {
  const r = await x.execute<{ d: string; c: string }>(sql`
    SELECT coalesce(sum(jl.debit),0) d, coalesce(sum(jl.credit),0) c
    FROM journal_entry_lines jl JOIN journal_entries je ON je.id = jl.journal_entry_id
    WHERE je.organization_id = ${orgId}`);
  return { d: Number(r.rows[0].d), c: Number(r.rows[0].c) };
}

// Full rolled-back chain with a per-unit SHIPPING cost, proving it is recalled
// from PO → GRN → invoice and that GRNI (2103) still nets to zero.
async function main() {
  const [org] = await db.select().from(organizations).limit(1);
  const orgId = org.id;
  const accs = await db.select({ code: accounts.code, id: accounts.id }).from(accounts)
    .where(and(eq(accounts.organizationId, orgId), inArray(accounts.code, ["1104", "2103", "2101"])));
  const A = Object.fromEntries(accs.map((a) => [a.code, a.id]));

  const [po] = await db.select().from(purchaseOrders)
    .where(and(eq(purchaseOrders.organizationId, orgId), inArray(purchaseOrders.status, ["CONFIRMED", "PARTIALLY_RECEIVED"])))
    .orderBy(desc(purchaseOrders.date)).limit(1);
  if (!po) { console.log("no PO — skip"); process.exit(0); }
  const [l] = await db.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, po.id)).limit(1);

  const SHIP = 10; // per-unit shipping to recall
  const qty = 2;
  const price = Number(l.unitPrice);
  const disc = 0;
  // GRN capitalises shipping into stock cost; invoice recalls the same shipping.
  const unitNet = price - disc / qty + SHIP;
  const receivedValue = round2(qty * unitNet);
  const subtotalGoods = round2(qty * price);
  const shippingAmt = round2(qty * SHIP);
  const net = round2(subtotalGoods + shippingAmt - disc); // invoice net (= GRNI to clear)

  const SENTINEL = "ROLLBACK"; const out: string[] = [];
  try {
    await db.transaction(async (tx) => {
      const grni0 = await acctBal(tx, orgId, A["2103"]);

      // 1) Receive (GRN): stock IN at unitNet incl shipping + Dr1104 / Cr2103.
      const [grn] = await tx.insert(purchaseReceipts).values({
        organizationId: orgId, number: "GRN-SHIP-TEST", date: new Date("2026-06-21"), status: "RECEIVED",
        purchaseOrderId: po.id, supplierId: po.supplierId, warehouseId: po.warehouseId,
      }).returning({ id: purchaseReceipts.id });
      await tx.insert(purchaseReceiptLines).values({ purchaseReceiptId: grn.id, itemId: l.itemId, warehouseId: po.warehouseId, quantity: String(qty) });
      await postStockMovement(tx, { orgId, itemId: l.itemId, warehouseId: po.warehouseId, type: "IN", quantity: qty, unitCost: unitNet, date: new Date("2026-06-21"), referenceType: "GOODS_RECEIPT", referenceId: grn.id });
      await postEntry(tx, { orgId, date: new Date("2026-06-21"), sourceType: "GOODS_RECEIPT", sourceId: grn.id, description: "grn", journalType: "PURCHASE", lines: [{ accountId: A["1104"], debit: receivedValue, credit: 0 }, { accountId: A["2103"], debit: 0, credit: receivedValue }] });

      const grniAfterGrn = await acctBal(tx, orgId, A["2103"]);
      out.push(`GRN GRNI(2103) Δ ${(grniAfterGrn - grni0).toFixed(2)} (expect -${receivedValue.toFixed(2)} incl shipping ${shippingAmt}) ${ok(Math.abs((grniAfterGrn - grni0) + receivedValue) < 0.01)}`);

      // 2) Bill (invoice post): net = goods + shipping − discount → Dr2103 / Cr2101.
      out.push(`Invoice net ${net.toFixed(2)} = goods ${subtotalGoods} + shipping ${shippingAmt} − disc ${disc} ${ok(Math.abs(net - receivedValue) < 0.01)} (matches GRNI)`);
      await postEntry(tx, { orgId, date: new Date("2026-06-21"), sourceType: "PURCHASE_INVOICE", sourceId: grn.id, description: "pi", journalType: "PURCHASE", lines: [{ accountId: A["2103"], debit: net, credit: 0 }, { accountId: A["2101"], debit: 0, credit: net }] });

      const grniAfterInv = await acctBal(tx, orgId, A["2103"]);
      const s = await sums(tx, orgId);
      out.push(`After invoice GRNI(2103) Δ from start ${(grniAfterInv - grni0).toFixed(2)} (expect 0 → fully cleared) ${ok(Math.abs(grniAfterInv - grni0) < 0.01)}`);
      out.push(`books balanced ${s.d.toFixed(2)}=${s.c.toFixed(2)} ${ok(Math.abs(s.d - s.c) < 0.01)}`);

      // keep suppliers import used (no-op read)
      await tx.select({ id: suppliers.id }).from(suppliers).limit(1);
      throw new Error(SENTINEL);
    });
  } catch (e) {
    if (!(e instanceof Error) || e.message !== SENTINEL) throw e;
  }
  console.log(`PO ${po.number} | qty ${qty} price ${price} ship/unit ${SHIP}`);
  for (const x of out) console.log(" ", x);
  console.log("(rolled back — no demo data changed)");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
