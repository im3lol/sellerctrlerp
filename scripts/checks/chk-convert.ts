// Faithful test of SO→invoice conversion at the data layer, rolled back so demo data is untouched.
import { and, eq } from "drizzle-orm";
import { db, pool } from "@/lib/db";
import { organizations, salesOrders, salesOrderLines, salesInvoices, salesInvoiceLines, customers } from "@/db/schema";

const ROLLBACK = "ROLLBACK_SENTINEL";
async function main() {
  const [org] = await db.select().from(organizations).limit(1);
  const [so] = await db.select().from(salesOrders)
    .where(and(eq(salesOrders.organizationId, org.id), eq(salesOrders.number, "SO-2026-0001"))).limit(1);
  const lines = await db.select().from(salesOrderLines).where(eq(salesOrderLines.salesOrderId, so.id));
  console.log("SO", so.number, "status", so.status, "lines", lines.length, "total", so.totalAmount);

  try {
    await db.transaction(async (tx) => {
      // Mirror convert: create invoice from SO lines + bump customer balance + mark INVOICED.
      const [inv] = await tx.insert(salesInvoices).values({
        organizationId: org.id, number: "SI-TEST-CONV", customerId: so.customerId, date: so.date,
        status: "DRAFT", subtotal: so.subtotal, taxAmount: so.taxAmount, totalAmount: so.totalAmount,
        paidAmount: "0", balanceDue: so.totalAmount, notes: `من أمر بيع ${so.number}`,
      }).returning();
      await tx.insert(salesInvoiceLines).values(lines.map((l) => ({
        salesInvoiceId: inv.id, itemId: l.itemId, quantity: l.quantity, unitPrice: l.unitPrice,
        discountAmount: l.discountAmount, taxAmount: l.taxAmount, totalAmount: l.totalAmount,
      })));
      await tx.update(salesOrders).set({ status: "INVOICED" }).where(eq(salesOrders.id, so.id));

      const il = await tx.select().from(salesInvoiceLines).where(eq(salesInvoiceLines.salesInvoiceId, inv.id));
      const [so2] = await tx.select({ s: salesOrders.status }).from(salesOrders).where(eq(salesOrders.id, so.id));
      console.log("→ invoice created:", inv.number, "total", inv.totalAmount, "lines", il.length);
      console.log("→ SO status now:", so2.s);
      console.log("→ totals match:", inv.totalAmount === so.totalAmount ? "✅" : "❌", "| lines match:", il.length === lines.length ? "✅" : "❌");
      throw new Error(ROLLBACK); // undo — keep demo data pristine
    });
  } catch (e) {
    if (e instanceof Error && e.message === ROLLBACK) console.log("✅ rolled back — demo data untouched");
    else throw e;
  }
}
main().catch((e) => { console.error("❌", e.message); process.exitCode = 1; }).finally(() => pool.end());
