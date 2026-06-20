import { and, asc, eq, gt, inArray, or } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { suppliers, purchaseInvoices, accounts } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { VoucherForm } from "@/components/erp/voucher-form";

export default async function NewPaymentPage() {
  const { orgId } = await requireErpModule("purchases.view");

  const [parties, invoices, cashAccs] = await Promise.all([
    db.select({ id: suppliers.id, code: suppliers.code, name: suppliers.nameAr })
      .from(suppliers).where(eq(suppliers.organizationId, orgId)).orderBy(asc(suppliers.code)),
    db.select({ id: purchaseInvoices.id, number: purchaseInvoices.number, partyId: purchaseInvoices.supplierId, balanceDue: purchaseInvoices.balanceDue })
      .from(purchaseInvoices)
      .where(and(
        eq(purchaseInvoices.organizationId, orgId),
        or(eq(purchaseInvoices.status, "POSTED"), eq(purchaseInvoices.status, "PARTIAL_PAID")),
        gt(purchaseInvoices.balanceDue, "0"),
      ))
      .orderBy(asc(purchaseInvoices.date)),
    db.select({ id: accounts.id, code: accounts.code, name: accounts.nameAr })
      .from(accounts)
      .where(and(eq(accounts.organizationId, orgId), eq(accounts.isLeaf, true), inArray(accounts.code, ["1101", "1102"])))
      .orderBy(asc(accounts.code)),
  ]);

  return (
    <div className="space-y-6">
      <ErpPageHeader icon="Banknote" title="سند صرف جديد" subtitle="دفع لمورد" backHref="/erp/purchases/payments" />
      <VoucherForm
        mode="payment"
        parties={parties}
        invoices={invoices.map((i) => ({ ...i, balanceDue: Number(i.balanceDue) }))}
        cashAccounts={cashAccs}
      />
    </div>
  );
}
