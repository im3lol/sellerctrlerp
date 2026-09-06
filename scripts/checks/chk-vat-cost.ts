/**
 * Does the capitalised-VAT cycle actually clear GRNI? Builds a real order + receipt in a
 * transaction, posts both legs the way the actions do, then rolls the whole thing back.
 * Exercises the REAL receiptLineCosts, which is the function that changed.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  organizations, accounts, items, warehouses, suppliers,
  purchaseOrders, purchaseOrderLines, purchaseReceipts, purchaseReceiptLines,
  journalEntries, journalEntryLines,
} from "@/db/schema";
import { postEntry } from "@/lib/erp/posting";
import { receiptLineCosts } from "@/lib/erp/receipt-cost";
import { round2 } from "@/lib/erp/money";

const r2 = round2;
const ok = (b: boolean) => (b ? "PASS" : "**FAIL**");

async function main() {
  // The first org with something to buy — a fresh tenant has no items and nothing to prove.
  const orgs = await db.select({ id: organizations.id }).from(organizations);
  let orgId = "";
  for (const o of orgs) {
    const [it] = await db.select({ id: items.id }).from(items).where(eq(items.organizationId, o.id)).limit(1);
    const [sp] = await db.select({ id: suppliers.id }).from(suppliers).where(eq(suppliers.organizationId, o.id)).limit(1);
    if (it && sp) { orgId = o.id; break; }
  }
  if (!orgId) { console.log("no org with items/suppliers — skip"); process.exit(0); }
  const accs = await db.select({ code: accounts.code, id: accounts.id }).from(accounts)
    .where(and(eq(accounts.organizationId, orgId), inArray(accounts.code, ["1104", "2103", "2101", "1107"])));
  const A = Object.fromEntries(accs.map((a) => [a.code, a.id])) as Record<string, string>;
  const [item] = await db.select().from(items).where(eq(items.organizationId, orgId)).limit(1);
  const [wh] = await db.select().from(warehouses).where(eq(warehouses.organizationId, orgId)).limit(1);
  const [sup] = await db.select().from(suppliers).where(eq(suppliers.organizationId, orgId)).limit(1);
  if (!item || !wh || !sup) { console.log("no item/warehouse/supplier — skip"); process.exit(0); }

  // 4 pieces at 100, 10 freight each, 20 discount on the line, 14% VAT on (400 − 20).
  const QTY = 4, PRICE = 100, SHIP = 10, DISC = 20, TAX = r2((QTY * PRICE - DISC) * 0.14);
  const out: string[] = [];
  const SENTINEL = "ROLLBACK";

  try {
    await db.transaction(async (tx) => {
      const [po] = await tx.insert(purchaseOrders).values({
        organizationId: orgId, number: "PO-VATCHK", supplierId: sup.id, warehouseId: wh.id,
        date: new Date("2026-09-06"), status: "CONFIRMED",
        subtotal: String(QTY * PRICE), shippingAmount: String(QTY * SHIP), discountAmount: String(DISC),
        taxAmount: String(TAX), totalAmount: String(r2(QTY * PRICE + QTY * SHIP - DISC + TAX)),
      }).returning({ id: purchaseOrders.id });
      await tx.insert(purchaseOrderLines).values({
        organizationId: orgId, purchaseOrderId: po.id, itemId: item.id, quantity: String(QTY),
        unitPrice: String(PRICE), shippingPerUnit: String(SHIP), discountAmount: String(DISC),
        taxAmount: String(TAX), totalAmount: String(r2(QTY * PRICE + QTY * SHIP - DISC + TAX)),
      });

      for (const capitalise of [false, true]) {
        const taxPerUnit = capitalise ? TAX / QTY : 0;
        const [grn] = await tx.insert(purchaseReceipts).values({
          organizationId: orgId, number: `GRN-VATCHK-${capitalise ? "ON" : "OFF"}`, supplierId: sup.id,
          warehouseId: wh.id, purchaseOrderId: po.id, date: new Date("2026-09-06"), status: "RECEIVED",
        }).returning({ id: purchaseReceipts.id });
        await tx.insert(purchaseReceiptLines).values({
          organizationId: orgId, purchaseReceiptId: grn.id, itemId: item.id, warehouseId: wh.id,
          quantity: String(QTY), shippingPerUnit: String(SHIP), taxPerUnit: String(taxPerUnit),
        });

        // ── the real cost definition ──
        const costs = await receiptLineCosts(tx, { id: grn.id, purchaseOrderId: po.id, warehouseId: wh.id });
        const grni = r2(costs.reduce((s, l) => s + l.value, 0));
        const expected = r2(QTY * (PRICE - DISC / QTY + SHIP + taxPerUnit));
        out.push(`[${capitalise ? "capitalised" : "recoverable"}] unit cost ${costs[0].unitNet.toFixed(2)} · GRNI ${grni.toFixed(2)} (expect ${expected.toFixed(2)}) ${ok(Math.abs(grni - expected) < 0.01)}`);

        // ── receipt leg: Dr 1104 / Cr 2103 ──
        const before = await bal(tx, orgId, [A["2103"], A["1107"]]);
        await post(tx, orgId, `GRN ${capitalise}`, [
          { accountId: A["1104"], debit: grni, credit: 0 },
          { accountId: A["2103"], debit: 0, credit: grni },
        ]);

        // ── invoice leg, exactly as postPurchaseInvoiceAction now does ──
        const capTax = Math.min(r2(QTY * taxPerUnit), TAX);
        const recTax = r2(TAX - capTax);
        const net = r2(QTY * PRICE + QTY * SHIP - DISC + capTax);
        const total = r2(QTY * PRICE + QTY * SHIP - DISC + TAX);
        const variance = r2(net - grni);
        const lines = [
          { accountId: A["2103"], debit: grni, credit: 0 },
          { accountId: A["2101"], debit: 0, credit: total },
        ];
        if (recTax > 0.004) lines.splice(1, 0, { accountId: A["1107"], debit: recTax, credit: 0 });
        if (Math.abs(variance) > 0.004) lines.push({ accountId: A["1104"], debit: Math.max(0, variance), credit: Math.max(0, -variance) });
        await post(tx, orgId, `PI ${capitalise}`, lines);

        const after = await bal(tx, orgId, [A["2103"], A["1107"]]);
        const grniDelta = r2((after[A["2103"]] ?? 0) - (before[A["2103"]] ?? 0));
        const vatDelta = r2((after[A["1107"]] ?? 0) - (before[A["1107"]] ?? 0));
        out.push(`   variance ${variance.toFixed(2)} · GRNI net movement ${grniDelta.toFixed(2)} (expect 0.00) ${ok(Math.abs(grniDelta) < 0.01)}`);
        out.push(`   input VAT 1107 ${vatDelta.toFixed(2)} (expect ${capitalise ? "0.00 — rides in the goods" : TAX.toFixed(2)}) ${ok(Math.abs(vatDelta - (capitalise ? 0 : TAX)) < 0.01)}`);
      }
      throw new Error(SENTINEL);
    });
  } catch (e) {
    if (!(e instanceof Error) || e.message !== SENTINEL) throw e;
  }
  for (const l of out) console.log(l);
  console.log("(rolled back — nothing persisted)");
  process.exit(out.some((l) => l.includes("FAIL")) ? 1 : 0);
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
async function post(tx: Tx, orgId: string, desc: string, lines: { accountId: string; debit: number; credit: number }[]) {
  // The real poster — it also enforces the balanced-entry rule, which is half the point.
  await postEntry(tx, {
    orgId, date: new Date("2026-09-06"), sourceType: "PURCHASE_INVOICE", sourceId: crypto.randomUUID(),
    description: desc, journalType: "PURCHASE",
    lines: lines.map((l) => ({ ...l, debit: r2(l.debit), credit: r2(l.credit) })),
  });
}
async function bal(tx: Tx, orgId: string, ids: string[]) {
  const rows = await tx.select({ accountId: journalEntryLines.accountId, debit: journalEntryLines.debit, credit: journalEntryLines.credit })
    .from(journalEntryLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalEntryLines.journalEntryId))
    .where(and(eq(journalEntryLines.organizationId, orgId), eq(journalEntries.status, "POSTED"), inArray(journalEntryLines.accountId, ids.filter(Boolean))));
  const out: Record<string, number> = {};
  for (const r of rows) out[r.accountId] = (out[r.accountId] ?? 0) + Number(r.debit) - Number(r.credit);
  return out;
}

main().catch((e) => { console.error(e); process.exit(1); });
