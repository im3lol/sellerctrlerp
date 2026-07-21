import { and, asc, eq, gt, inArray, or } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { customers, salesInvoices, accounts } from "@/db/schema";
import { resolveAccountCodes } from "@/lib/erp/accounting-config";
import { ErpPageHeader } from "@/components/erp/page-header";
import { VoucherForm } from "@/components/erp/voucher-form";

export default async function NewReceiptPage({ searchParams }: { searchParams: Promise<{ invoice?: string }> }) {
  return loadErpPage("sales.view", async ({ orgId }) => {
    const { invoice: invoiceParam } = await searchParams;
    const rc = await resolveAccountCodes(orgId, ["1101", "1102"]);

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
        .where(and(eq(accounts.organizationId, orgId), eq(accounts.isLeaf, true), inArray(accounts.code, [rc["1101"], rc["1102"]])))
        .orderBy(asc(accounts.code)),
    ]);

    const preInvoice = invoiceParam ? invoices.find((i) => i.number === invoiceParam || i.id === invoiceParam) : undefined;

    return (
      <div className="space-y-6">
        <ErpPageHeader icon="HandCoins" title="سند قبض جديد" subtitle="تحصيل من عميل" backHref="/sales/receipts" />
        <VoucherForm
          mode="receipt"
          parties={parties}
          invoices={invoices.map((i) => ({ ...i, balanceDue: Number(i.balanceDue) }))}
          cashAccounts={cashAccs}
          defaultPartyId={preInvoice?.partyId ?? undefined}
          defaultInvoiceId={preInvoice?.id ?? undefined}
        />
      </div>
    );
  });
}
