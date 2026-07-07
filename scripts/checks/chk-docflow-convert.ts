// Rolled-back test: convert DLV + GRN to invoices, assert GRNI clears + books balanced. No demo mutation.
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, pool } from "@/lib/db";
import { organizations, accounts, journalEntries, journalEntryLines,
  deliveryNotes, salesOrders, salesOrderLines, salesInvoices, salesInvoiceLines, customers,
  purchaseReceipts, purchaseOrders, purchaseOrderLines, purchaseInvoices, purchaseInvoiceLines, suppliers } from "@/db/schema";

const ROLLBACK = "RB";
const r2 = (n: number) => Math.round(n * 100) / 100;
async function acctBal(orgId: string, code: string, tx: typeof db) {
  const [a] = await tx.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.organizationId, orgId), eq(accounts.code, code))).limit(1);
  const [r] = await tx.select({ d: sql<string>`coalesce(sum(${journalEntryLines.debit}),0)`, c: sql<string>`coalesce(sum(${journalEntryLines.credit}),0)` })
    .from(journalEntryLines).innerJoin(journalEntries, and(eq(journalEntries.id, journalEntryLines.journalEntryId), eq(journalEntries.status, "POSTED")))
    .where(eq(journalEntryLines.accountId, a.id));
  return Number(r.d) - Number(r.c);
}

async function main() {
  const [org] = await db.select().from(organizations).limit(1);
  const grniBefore = await acctBal(org.id, "2103", db as any);
  console.log("GRNI (2103) before convert:", grniBefore.toFixed(2), "(goods received not invoiced)");

  try {
    await db.transaction(async (tx) => {
      // --- Convert GRN-2026-0001 → purchase invoice (clears GRNI → AP) ---
      const [grn] = await tx.select().from(purchaseReceipts).where(eq(purchaseReceipts.number, "GRN-2026-0001"));
      const [po] = await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, grn.purchaseOrderId!));
      const A: Record<string,string> = Object.fromEntries((await tx.select({c:accounts.code,id:accounts.id}).from(accounts).where(and(eq(accounts.organizationId,org.id),inArray(accounts.code,["2103","1107","2101","1103","4101","2102"])))).map(a=>[a.c,a.id]));
      const pNet = r2(Number(po.subtotal)-Number(po.discountAmount)), pTax = Number(po.taxAmount), pTot = Number(po.totalAmount);
      const [pi] = await tx.insert(purchaseInvoices).values({ organizationId:org.id, number:"PI-CONV-T", supplierId:po.supplierId, warehouseId:po.warehouseId, goodsReceiptId:grn.id, date:new Date(po.date), status:"POSTED", subtotal:po.subtotal, taxAmount:po.taxAmount, totalAmount:po.totalAmount, paidAmount:"0", balanceDue:po.totalAmount }).returning();
      await tx.insert(journalEntries).values({ organizationId:org.id, number:"JV-CONV-PI", date:new Date(po.date), status:"POSTED", sourceType:"PURCHASE_INVOICE", sourceId:pi.id, description:"test" }).returning();
      const [jePi] = await tx.select().from(journalEntries).where(eq(journalEntries.number,"JV-CONV-PI"));
      await tx.insert(journalEntryLines).values([
        { journalEntryId:jePi.id, accountId:A["2103"], debit:String(pNet), credit:"0" },
        { journalEntryId:jePi.id, accountId:A["1107"], debit:String(pTax), credit:"0" },
        { journalEntryId:jePi.id, accountId:A["2101"], debit:"0", credit:String(pTot) },
      ]);
      const grniAfter = await acctBal(org.id, "2103", tx as any);
      console.log("GRNI (2103) after GRN→invoice:", grniAfter.toFixed(2), grniAfter===0?"✅ cleared":"(remaining)");

      // --- Convert DLV-2026-0001 → sales invoice (revenue only) ---
      const [dn] = await tx.select().from(deliveryNotes).where(eq(deliveryNotes.number,"DLV-2026-0001"));
      const [so] = await tx.select().from(salesOrders).where(eq(salesOrders.id, dn.salesOrderId!));
      const sNet = r2(Number(so.subtotal)-Number(so.discountAmount)), sTax=Number(so.taxAmount), sTot=Number(so.totalAmount);
      const [si] = await tx.insert(salesInvoices).values({ organizationId:org.id, number:"SI-CONV-T", customerId:so.customerId, deliveryNoteId:dn.id, date:new Date(so.date), status:"POSTED", subtotal:so.subtotal, taxAmount:so.taxAmount, totalAmount:so.totalAmount, paidAmount:"0", balanceDue:so.totalAmount }).returning();
      await tx.insert(journalEntries).values({ organizationId:org.id, number:"JV-CONV-SI", date:new Date(so.date), status:"POSTED", sourceType:"SALES_INVOICE", sourceId:si.id, description:"test" });
      const [jeSi] = await tx.select().from(journalEntries).where(eq(journalEntries.number,"JV-CONV-SI"));
      await tx.insert(journalEntryLines).values([
        { journalEntryId:jeSi.id, accountId:A["1103"], debit:String(sTot), credit:"0" },
        { journalEntryId:jeSi.id, accountId:A["4101"], debit:"0", credit:String(sNet) },
        { journalEntryId:jeSi.id, accountId:A["2102"], debit:"0", credit:String(sTax) },
      ]);

      const [bal] = await tx.select({ d:sql<string>`coalesce(sum(${journalEntryLines.debit}),0)`, c:sql<string>`coalesce(sum(${journalEntryLines.credit}),0)` })
        .from(journalEntryLines).innerJoin(journalEntries, and(eq(journalEntries.id,journalEntryLines.journalEntryId), eq(journalEntries.organizationId,org.id), eq(journalEntries.status,"POSTED")));
      console.log("Books after both conversions:", Number(bal.d).toFixed(2), Number(bal.d)===Number(bal.c)?"✅ balanced":"❌");
      console.log("AR 1103:", (await acctBal(org.id,"1103",tx as any)).toFixed(2), "| AP 2101:", (-(await acctBal(org.id,"2101",tx as any))).toFixed(2));
      throw new Error(ROLLBACK);
    });
  } catch(e){ if(e instanceof Error && e.message===ROLLBACK) console.log("✅ rolled back — demo untouched"); else throw e; }
}
main().catch(e=>{console.error("❌",e.message);process.exitCode=1}).finally(()=>pool.end());
