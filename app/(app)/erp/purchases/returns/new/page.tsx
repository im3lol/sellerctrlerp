import { and, desc, eq, inArray } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { purchaseInvoices, purchaseInvoiceLines, items } from "@/db/schema";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ErpPageHeader } from "@/components/erp/page-header";
import { ReturnForm, type ReturnLine } from "@/components/erp/return-form";

const selectCls = "flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm";

export default async function NewPurchaseReturnPage({ searchParams }: { searchParams: Promise<{ invoice?: string }> }) {
  const { orgId } = await requireErpModule("purchases.view");
  const sp = await searchParams;
  const invoiceId = sp.invoice ?? "";

  const eligible = await db
    .select({ id: purchaseInvoices.id, number: purchaseInvoices.number })
    .from(purchaseInvoices)
    .where(and(eq(purchaseInvoices.organizationId, orgId), inArray(purchaseInvoices.status, ["POSTED", "PARTIAL_PAID", "PAID"])))
    .orderBy(desc(purchaseInvoices.date));

  let lines: ReturnLine[] = [];
  let invoiceNumber = "";
  if (invoiceId) {
    const inv = eligible.find((i) => i.id === invoiceId);
    invoiceNumber = inv?.number ?? "";
    const rows = await db
      .select({ itemId: purchaseInvoiceLines.itemId, name: items.nameAr, unitPrice: purchaseInvoiceLines.unitPrice, quantity: purchaseInvoiceLines.quantity })
      .from(purchaseInvoiceLines)
      .innerJoin(items, eq(items.id, purchaseInvoiceLines.itemId))
      .where(eq(purchaseInvoiceLines.purchaseInvoiceId, invoiceId));
    lines = rows.map((r) => ({ itemId: r.itemId, name: r.name ?? "", unitPrice: Number(r.unitPrice), maxQty: Number(r.quantity) }));
  }

  return (
    <div className="space-y-6">
      <ErpPageHeader icon="Undo2" title="مرتجع مشتريات جديد" subtitle="إشعار مدين للمورد" backHref="/erp/purchases/returns" />

      <Card>
        <CardHeader>
          <CardTitle>اختر الفاتورة</CardTitle>
          <CardDescription>المرتجع يرتبط بفاتورة شراء مُرحّلة.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-wrap items-end gap-3">
            <div className="space-y-2">
              <Label htmlFor="invoice">الفاتورة</Label>
              <select id="invoice" name="invoice" defaultValue={invoiceId} className={`${selectCls} min-w-64`}>
                <option value="">— اختر الفاتورة —</option>
                {eligible.map((i) => <option key={i.id} value={i.id}>{i.number}</option>)}
              </select>
            </div>
            <Button type="submit">تحميل البنود</Button>
          </form>
        </CardContent>
      </Card>

      {invoiceId && lines.length > 0 && (
        <ReturnForm mode="purchase" invoiceId={invoiceId} invoiceNumber={invoiceNumber} lines={lines} />
      )}
      {invoiceId && lines.length === 0 && (
        <div className="rounded-xl border border-dashed py-10 text-center text-muted-foreground">لا توجد بنود لهذه الفاتورة.</div>
      )}
    </div>
  );
}
