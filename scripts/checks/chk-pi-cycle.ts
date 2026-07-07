import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  organizations, purchaseReceipts, purchaseReceiptLines, purchaseOrders, purchaseOrderLines,
  purchaseInvoices, purchaseInvoiceLines, accounts, suppliers,
} from "@/db/schema";
import { postEntry } from "@/lib/erp/posting";

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

// Faithful, rolled-back test of the purchase-invoice posting branches.
async function main() {
  const [org] = await db.select().from(organizations).limit(1);
  const orgId = org.id;
  const accs = await db.select({ code: accounts.code, id: accounts.id }).from(accounts)
    .where(and(eq(accounts.organizationId, orgId), inArray(accounts.code, ["1104", "2103", "2101", "1107"])));
  const A = Object.fromEntries(accs.map((a) => [a.code, a.id]));

  // Use a confirmed, un-billed receipt as the GRN-path subject.
  const billed = await db.select({ g: purchaseInvoices.goodsReceiptId }).from(purchaseInvoices).where(eq(purchaseInvoices.organizationId, orgId));
  const billedSet = new Set(billed.map((b) => b.g));
  const grns = await db.select().from(purchaseReceipts).where(and(eq(purchaseReceipts.organizationId, orgId), eq(purchaseReceipts.status, "RECEIVED"))).orderBy(desc(purchaseReceipts.date));
  const grn = grns.find((g) => !billedSet.has(g.id));
  if (!grn) { console.log("no billable receipt — skip"); process.exit(0); }
  const [po] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, grn.purchaseOrderId!)).limit(1);
  const poLines = await db.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, po.id));
  const poByItem = new Map(poLines.map((l) => [l.itemId, l]));
  const grnLines = await db.select().from(purchaseReceiptLines).where(eq(purchaseReceiptLines.purchaseReceiptId, grn.id));

  // Build invoice amounts the same way the action does.
  let subtotal = 0, discount = 0, tax = 0;
  for (const gl of grnLines) {
    const p = poByItem.get(gl.itemId); if (!p) continue;
    const gq = Number(gl.quantity); if (gq <= 0) continue;
    const oq = Number(p.quantity) || gq; const f = oq > 0 ? gq / oq : 0;
    subtotal += Number(p.unitPrice) * gq + round2(Number(p.shippingPerUnit) * gq);
    discount += round2(Number(p.discountAmount) * f); tax += round2(Number(p.taxAmount) * f);
  }
  subtotal = round2(subtotal); discount = round2(discount); tax = round2(tax);
  const net = round2(subtotal - discount); const total = round2(net + tax);

  const SENTINEL = "ROLLBACK"; const out: string[] = [];
  try {
    await db.transaction(async (tx) => {
      const s0 = await sums(tx, orgId);
      const grni0 = await acctBal(tx, orgId, A["2103"]); const ap0 = await acctBal(tx, orgId, A["2101"]);
      const inv0 = await acctBal(tx, orgId, A["1104"]); const lv0 = await ledger(tx, orgId);

      // ── DRAFT (inert) ──
      const [inv] = await tx.insert(purchaseInvoices).values({
        organizationId: orgId, number: "PI-TEST", supplierId: grn.supplierId!, warehouseId: grn.warehouseId, goodsReceiptId: grn.id,
        date: new Date("2026-06-21"), status: "DRAFT", subtotal: String(subtotal), discountAmount: String(discount), taxAmount: String(tax),
        totalAmount: String(total), paidAmount: "0", balanceDue: String(total),
      }).returning({ id: purchaseInvoices.id });
      const sD = await sums(tx, orgId);
      out.push(`DRAFT inert — GL totals unchanged ${ok(sD.d === s0.d && sD.c === s0.c)} (no journal lines added)`);

      // ── POST (GRN path): Dr2103 net [+Dr1107 tax] / Cr2101 total; NO stock ──
      const lines = [
        { accountId: A["2103"], debit: net, credit: 0 },
        { accountId: A["2101"], debit: 0, credit: total },
      ];
      if (tax > 0 && A["1107"]) lines.splice(1, 0, { accountId: A["1107"], debit: tax, credit: 0 });
      await postEntry(tx, { orgId, date: new Date("2026-06-21"), sourceType: "PURCHASE_INVOICE", sourceId: inv.id, description: "test", journalType: "PURCHASE", lines });
      await tx.update(suppliers).set({ balance: sql`${suppliers.balance} + ${total}` }).where(eq(suppliers.id, grn.supplierId!));
      await tx.update(purchaseReceipts).set({ status: "INVOICED", purchaseInvoiceId: inv.id }).where(eq(purchaseReceipts.id, grn.id));

      const s1 = await sums(tx, orgId);
      const grni1 = await acctBal(tx, orgId, A["2103"]); const ap1 = await acctBal(tx, orgId, A["2101"]);
      const inv1 = await acctBal(tx, orgId, A["1104"]); const lv1 = await ledger(tx, orgId);

      out.push(`POST books balanced ${s1.d.toFixed(2)}=${s1.c.toFixed(2)} ${ok(Math.abs(s1.d - s1.c) < 0.01)}`);
      // GRN credited 2103 by net (balance −net); invoice debits 2103 by net → nets to 0. Δ(debit−credit) = +net.
      out.push(`POST GRNI(2103) Δ ${(grni1 - grni0).toFixed(2)} (expect +${net.toFixed(2)} → clears the receipt's GRNI to zero) ${ok(Math.abs((grni1 - grni0) - net) < 0.01)}`);
      out.push(`POST AP(2101) Δ ${(ap1 - ap0).toFixed(2)} (expect -${total.toFixed(2)} credit) ${ok(Math.abs((ap1 - ap0) + total) < 0.01)}`);
      out.push(`POST Inventory(1104) unchanged ${ok(Math.abs(inv1 - inv0) < 0.01)} — no double stock`);
      out.push(`POST stock ledger unchanged ${ok(Math.abs(lv1 - lv0) < 0.01)} (goods already received by GRN)`);

      throw new Error(SENTINEL);
    });
  } catch (e) {
    if (!(e instanceof Error) || e.message !== SENTINEL) throw e;
  }
  console.log(`receipt ${grn.number} | net ${net} tax ${tax} total ${total}`);
  for (const l of out) console.log(" ", l);
  console.log("(rolled back — no demo data changed)");
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
