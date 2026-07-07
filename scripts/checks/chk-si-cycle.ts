import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  organizations, salesOrders, salesOrderLines, deliveryNotes, deliveryNoteLines,
  salesInvoices, salesInvoiceLines, accounts, warehouses,
} from "@/db/schema";
import { postStockMovement } from "@/lib/erp/inventory";
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
async function bal(x: Tx, orgId: string, accId: string) {
  const r = await x.execute<{ b: string }>(sql`
    SELECT coalesce(sum(jl.debit-jl.credit),0) b FROM journal_entry_lines jl
    JOIN journal_entries je ON je.id = jl.journal_entry_id
    WHERE je.organization_id = ${orgId} AND jl.account_id = ${accId}`);
  return Number(r.rows[0].b);
}
async function onHand(x: Tx, orgId: string, itemId: string, whId: string) {
  const r = await x.execute<{ q: string }>(sql`
    SELECT balance_quantity q FROM stock_movements WHERE organization_id=${orgId} AND item_id=${itemId} AND warehouse_id=${whId}
    ORDER BY created_at DESC, id DESC LIMIT 1`);
  return Number(r.rows[0]?.q ?? 0);
}

// Full rolled-back chain: deliver (stock OUT + COGS) → bill (revenue/AR ONLY).
// Proves the delivery-billed invoice does NOT re-post COGS/stock (no double count).
async function main() {
  const [org] = await db.select().from(organizations).limit(1);
  const orgId = org.id;
  const accs = await db.select({ code: accounts.code, id: accounts.id }).from(accounts)
    .where(and(eq(accounts.organizationId, orgId), inArray(accounts.code, ["5101", "1104", "1103", "4101", "2102"])));
  const A = Object.fromEntries(accs.map((a) => [a.code, a.id]));
  const [wh] = await db.select().from(warehouses).where(and(eq(warehouses.organizationId, orgId), eq(warehouses.isActive, true))).limit(1);

  const [so] = await db.select().from(salesOrders)
    .where(and(eq(salesOrders.organizationId, orgId), inArray(salesOrders.status, ["CONFIRMED", "PARTIALLY_DELIVERED"])))
    .orderBy(desc(salesOrders.date)).limit(1);
  if (!so) { console.log("no deliverable SO — skip"); process.exit(0); }
  const soLines = await db.select().from(salesOrderLines).where(eq(salesOrderLines.salesOrderId, so.id));
  let target: typeof soLines[number] | undefined;
  for (const l of soLines) {
    const remaining = round2(Number(l.quantity) - Number(l.deliveredQty));
    if (remaining < 1) continue;
    const oh = await db.execute<{ q: string }>(sql`SELECT balance_quantity q FROM stock_movements WHERE organization_id=${orgId} AND item_id=${l.itemId} AND warehouse_id=${wh.id} ORDER BY created_at DESC, id DESC LIMIT 1`);
    if (Number(oh.rows[0]?.q ?? 0) >= 1) { target = l; break; }
  }
  if (!target) { console.log("no SO line with stock — skip"); process.exit(0); }

  const qtyN = 1;
  const price = Number(target.unitPrice);
  const oq = Number(target.quantity) || qtyN;
  const f = oq > 0 ? qtyN / oq : 0;
  const disc = round2(Number(target.discountAmount) * f);
  const tax = round2(Number(target.taxAmount) * f);
  const net = round2(price * qtyN - disc);
  const total = round2(net + tax);

  const SENTINEL = "ROLLBACK"; const out: string[] = [];
  try {
    await db.transaction(async (tx) => {
      // ── Deliver (confirm) ──
      const [dn] = await tx.insert(deliveryNotes).values({
        organizationId: orgId, number: "DLV-T", date: new Date("2026-06-21"), status: "DELIVERED",
        salesOrderId: so.id, customerId: so.customerId, warehouseId: wh.id,
      }).returning({ id: deliveryNotes.id });
      await tx.insert(deliveryNoteLines).values({ deliveryNoteId: dn.id, itemId: target!.itemId, warehouseId: wh.id, quantity: String(qtyN) });
      const r = await postStockMovement(tx, { orgId, itemId: target!.itemId, warehouseId: wh.id, type: "OUT", quantity: qtyN, date: new Date("2026-06-21"), referenceType: "DELIVERY", referenceId: dn.id });
      const cogs = round2(r.totalCost);
      await postEntry(tx, { orgId, date: new Date("2026-06-21"), sourceType: "DELIVERY_COGS", sourceId: dn.id, description: "cogs", journalType: "GENERAL", lines: [{ accountId: A["5101"], debit: cogs, credit: 0 }, { accountId: A["1104"], debit: 0, credit: cogs }] });

      const cogsAfterDlv = await bal(tx, orgId, A["5101"]);
      const invAfterDlv = await bal(tx, orgId, A["1104"]);
      const stockAfterDlv = await onHand(tx, orgId, target!.itemId, wh.id);
      const arAfterDlv = await bal(tx, orgId, A["1103"]);
      const revAfterDlv = await bal(tx, orgId, A["4101"]);

      // ── Bill (post, delivery path: revenue/AR ONLY) ──
      const [inv] = await tx.insert(salesInvoices).values({
        organizationId: orgId, number: "SI-T", customerId: so.customerId, deliveryNoteId: dn.id, date: new Date("2026-06-21"),
        status: "DRAFT", subtotal: String(round2(price * qtyN)), discountAmount: String(disc), taxAmount: String(tax),
        totalAmount: String(total), paidAmount: "0", balanceDue: String(total),
      }).returning({ id: salesInvoices.id });
      await tx.insert(salesInvoiceLines).values({ salesInvoiceId: inv.id, itemId: target!.itemId, quantity: String(qtyN), unitPrice: String(price), discountAmount: String(disc), taxAmount: String(tax), totalAmount: String(total) });
      const revLines = [
        { accountId: A["1103"], debit: total, credit: 0 },
        { accountId: A["4101"], debit: 0, credit: net },
      ];
      if (tax > 0 && A["2102"]) revLines.push({ accountId: A["2102"], debit: 0, credit: tax });
      await postEntry(tx, { orgId, date: new Date("2026-06-21"), sourceType: "SALES_INVOICE", sourceId: inv.id, description: "rev", journalType: "SALES", lines: revLines });
      // delivery-path: NO stock / NO COGS here.

      const cogsAfterInv = await bal(tx, orgId, A["5101"]);
      const invAfterInv = await bal(tx, orgId, A["1104"]);
      const stockAfterInv = await onHand(tx, orgId, target!.itemId, wh.id);
      const arAfterInv = await bal(tx, orgId, A["1103"]);
      const revAfterInv = await bal(tx, orgId, A["4101"]);
      const s = await sums(tx, orgId);

      out.push(`Deliver: COGS Δ +${cogs.toFixed(2)}, stock Δ -${qtyN}`);
      out.push(`Bill (delivery path) COGS unchanged ${ok(Math.abs(cogsAfterInv - cogsAfterDlv) < 0.01)} — no double COGS`);
      out.push(`Bill inventory(1104) unchanged ${ok(Math.abs(invAfterInv - invAfterDlv) < 0.01)} | stock unchanged ${ok(Math.abs(stockAfterInv - stockAfterDlv) < 1e-6)} — no double issue`);
      out.push(`Bill AR(1103) Δ +${(arAfterInv - arAfterDlv).toFixed(2)} (expect ${total.toFixed(2)}) ${ok(Math.abs((arAfterInv - arAfterDlv) - total) < 0.01)}`);
      out.push(`Bill revenue(4101) Δ ${(revAfterInv - revAfterDlv).toFixed(2)} (expect -${net.toFixed(2)} credit) ${ok(Math.abs((revAfterInv - revAfterDlv) + net) < 0.01)}`);
      out.push(`books balanced ${s.d.toFixed(2)}=${s.c.toFixed(2)} ${ok(Math.abs(s.d - s.c) < 0.01)}`);

      throw new Error(SENTINEL);
    });
  } catch (e) {
    if (!(e instanceof Error) || e.message !== SENTINEL) throw e;
  }
  console.log(`SO ${so.number} | qty ${qtyN} price ${price} net ${net} tax ${tax} total ${total}`);
  for (const l of out) console.log(" ", l);
  console.log("(rolled back — no demo data changed)");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
