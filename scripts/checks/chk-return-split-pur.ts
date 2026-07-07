import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { organizations, purchaseInvoices, purchaseInvoiceLines, purchaseReceipts, accounts, stockMovements } from "@/db/schema";
import { postStockMovement } from "@/lib/erp/inventory";
import { postEntry } from "@/lib/erp/posting";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const round2 = (n: number) => Math.round(n * 100) / 100;
const ok = (c: boolean) => (c ? "✅" : "❌");

async function sums(x: Tx, o: string) {
  const r = await x.execute<{ d: string; c: string }>(sql`SELECT coalesce(sum(jl.debit),0) d, coalesce(sum(jl.credit),0) c
    FROM journal_entry_lines jl JOIN journal_entries je ON je.id=jl.journal_entry_id WHERE je.organization_id=${o}`);
  return { d: Number(r.rows[0].d), c: Number(r.rows[0].c) };
}
async function bal(x: Tx, o: string, a: string) {
  const r = await x.execute<{ b: string }>(sql`SELECT coalesce(sum(jl.debit-jl.credit),0) b FROM journal_entry_lines jl
    JOIN journal_entries je ON je.id=jl.journal_entry_id WHERE je.organization_id=${o} AND jl.account_id=${a}`);
  return Number(r.rows[0].b);
}

// Separated purchase return: PI return = MONEY ONLY (Dr 2101 / Cr 2103 [+Cr 1107]);
// GRN return = STOCK ONLY (Dr 2103 / Cr 1104 + stock out). Together: AP −total,
// GRNI net 0, inventory −net, balanced. Rolled back.
async function main() {
  const [org] = await db.select().from(organizations).limit(1);
  const o = org.id;
  const accs = await db.select({ code: accounts.code, id: accounts.id }).from(accounts)
    .where(and(eq(accounts.organizationId, o), inArray(accounts.code, ["2101", "2103", "1104", "1107"])));
  const A = Object.fromEntries(accs.map((a) => [a.code, a.id]));

  const invs = await db.select().from(purchaseInvoices)
    .where(and(eq(purchaseInvoices.organizationId, o), eq(purchaseInvoices.status, "POSTED"))).orderBy(desc(purchaseInvoices.date));
  const inv = invs.find((i) => i.goodsReceiptId);
  if (!inv) { console.log("no GRN-billed posted PI — skip"); process.exit(0); }
  const net = round2(Number(inv.subtotal) + Number((inv as { shippingAmount?: string }).shippingAmount ?? 0) - Number(inv.discountAmount));
  const tax = Number(inv.taxAmount);
  const total = round2(net + tax);
  // GRN stock-reverse value = original receipt movements value.
  const moves = await db.select({ itemId: stockMovements.itemId, quantity: stockMovements.quantity, unitCost: stockMovements.unitCost })
    .from(stockMovements).where(and(eq(stockMovements.organizationId, o), eq(stockMovements.referenceType, "GOODS_RECEIPT"), eq(stockMovements.referenceId, inv.goodsReceiptId!)));
  const [grn] = await db.select().from(purchaseReceipts).where(eq(purchaseReceipts.id, inv.goodsReceiptId!)).limit(1);

  const SENTINEL = "ROLLBACK"; const out: string[] = [];
  try {
    await db.transaction(async (tx) => {
      const ap0 = await bal(tx, o, A["2101"]); const grni0 = await bal(tx, o, A["2103"]); const inv0 = await bal(tx, o, A["1104"]);

      // 1) PI return — MONEY ONLY: Dr 2101 / Cr 2103 [+ Cr 1107].
      const money = [{ accountId: A["2101"], debit: total, credit: 0 }, { accountId: A["2103"], debit: 0, credit: net }];
      if (tax > 0 && A["1107"]) money.push({ accountId: A["1107"], debit: 0, credit: tax });
      await postEntry(tx, { orgId: o, date: new Date("2026-06-22"), sourceType: "PURCHASE_RETURN", sourceId: inv.id, description: "money", journalType: "PURCHASE", lines: money });
      const invM = await bal(tx, o, A["1104"]);
      out.push(`PI return money-only: inventory(1104) unchanged ${ok(Math.abs(invM - inv0) < 0.01)}`);

      // 2) GRN return — STOCK ONLY: stock OUT + Dr 2103 / Cr 1104.
      let val = 0;
      for (const m of moves) { const q = Number(m.quantity), c = Number(m.unitCost); await postStockMovement(tx, { orgId: o, itemId: m.itemId, warehouseId: grn.warehouseId, type: "OUT", quantity: q, unitCost: c, date: new Date("2026-06-22"), referenceType: "GOODS_RECEIPT_REVERSE", referenceId: grn.id }); val += round2(q * c); }
      val = round2(val);
      await postEntry(tx, { orgId: o, date: new Date("2026-06-22"), sourceType: "GOODS_RECEIPT_REVERSE", sourceId: grn.id, description: "stock", journalType: "PURCHASE", lines: [{ accountId: A["2103"], debit: val, credit: 0 }, { accountId: A["1104"], debit: 0, credit: val }] });

      const ap1 = await bal(tx, o, A["2101"]); const grni1 = await bal(tx, o, A["2103"]); const inv1 = await bal(tx, o, A["1104"]);
      const s = await sums(tx, o);
      // AP is a liability (credit balance); debiting it raises debit−credit by +total → payable reduced.
      out.push(`TOGETHER: AP(2101) Δ +${(ap1 - ap0).toFixed(2)} → payable reduced by ${total.toFixed(2)} ${ok(Math.abs((ap1 - ap0) - total) < 0.01)}`);
      out.push(`GRNI(2103) Δ ${(grni1 - grni0).toFixed(2)} (expect ~0 — money credits, stock debits) ${ok(Math.abs(grni1 - grni0) < 0.02)}`);
      out.push(`Inventory(1104) Δ ${(inv1 - inv0).toFixed(2)} (stock returned) ${ok((inv1 - inv0) < 0)}`);
      out.push(`books balanced ${s.d.toFixed(2)}=${s.c.toFixed(2)} ${ok(Math.abs(s.d - s.c) < 0.01)}`);
      throw new Error(SENTINEL);
    });
  } catch (e) {
    if (!(e instanceof Error) || e.message !== SENTINEL) throw e;
  }
  console.log(`PI ${inv.number} (GRN-billed) | net ${net} tax ${tax} total ${total} | stock val ${moves.length ? "ok" : "none"}`);
  for (const l of out) console.log(" ", l);
  console.log("(rolled back — no demo data changed)");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
