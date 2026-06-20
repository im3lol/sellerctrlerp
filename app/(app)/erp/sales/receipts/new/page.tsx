import { and, asc, eq, gt, inArray, or } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { customers, salesInvoices, accounts } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { VoucherForm } from "@/components/erp/voucher-form";

export default async function NewReceiptPage() {
  const { orgId } = await requireErpModule("sales.view");

  const [parties, invoices, cashAccs] = await Promise.all([
    db.select({ id: customers.id, code: customers.code, name: customers.nameAr })
      .from(customers).where(eq(customers.organizationId, orgId)).orderBy(asc(customers.code)),
    db.select({ id: salesInvoices.id, number: salesInvoices.number, partyId: salesInvoices.customerId, balanceDue: salesInvoices.balanceDue })
      .from(salesInvoices)
      .where(and(
        eq(salesInvoices.organizationId, orgId),
        or(eq(salesInvoices.status, "POSTED"), eq(salesInvoices.status, "PARTIAL_PAID")),
        gt(salesInvoices.balanceDue, "0"),
      ))
      .orderBy(asc(salesInvoices.date)),
    db.select({ id: accounts.id, code: accounts.code, name: accounts.nameAr })
      .from(accounts)
      .where(and(eq(accounts.organizationId, orgId), eq(accounts.isLeaf, true), inArray(accounts.code, ["1101", "1102"])))
      .orderBy(asc(accounts.code)),
  ]);

  return (
    <div className="space-y-6">
      <ErpPageHeader icon="HandCoins" title="سند قبض جديد" subtitle="تحصيل من عميل" backHref="/erp/sales/receipts" />
      <VoucherForm
        mode="receipt"
        parties={parties}
        invoices={invoices.map((i) => ({ ...i, balanceDue: Number(i.balanceDue) }))}
        cashAccounts={cashAccs}
      />
    </div>
  );
}
