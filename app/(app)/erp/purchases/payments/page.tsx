import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { requireErpModule, erpCan } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { paymentVouchers, suppliers, purchaseInvoices } from "@/db/schema";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Icon } from "@/components/icon";
import { ErpPageHeader } from "@/components/erp/page-header";

const fmt = (v: string | null) => Number(v ?? 0).toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dt = (d: Date) => new Date(d).toLocaleDateString("en-GB", { year: "numeric", month: "2-digit", day: "2-digit" });
const METHOD: Record<string, string> = { CASH: "نقدي", BANK: "تحويل بنكي", CARD: "بطاقة", CHEQUE: "شيك" };

export default async function PaymentsPage() {
  const { orgId, role } = await requireErpModule("purchases.view");
  const rows = await db
    .select({
      id: paymentVouchers.id,
      number: paymentVouchers.number,
      date: paymentVouchers.date,
      amount: paymentVouchers.amount,
      method: paymentVouchers.paymentMethod,
      supplier: suppliers.nameAr,
      invoice: purchaseInvoices.number,
    })
    .from(paymentVouchers)
    .leftJoin(suppliers, eq(suppliers.id, paymentVouchers.supplierId))
    .leftJoin(purchaseInvoices, eq(purchaseInvoices.id, paymentVouchers.purchaseInvoiceId))
    .where(eq(paymentVouchers.organizationId, orgId))
    .orderBy(desc(paymentVouchers.date), desc(paymentVouchers.number));

  const total = rows.reduce((s, r) => s + Number(r.amount), 0);

  return (
    <div className="space-y-6">
      <ErpPageHeader
        icon="Banknote"
        title="سندات الصرف"
        subtitle={`${rows.length} سند — إجمالي ${fmt(String(total))}`}
        action={
          erpCan(role, "purchases.pay") ? (
            <Button asChild>
              <Link href="/erp/purchases/payments/new"><Icon name="Plus" className="size-4" />سند صرف</Link>
            </Button>
          ) : undefined
        }
      />
      <Card>
        <CardHeader>
          <CardTitle>المدفوعات</CardTitle>
          <CardDescription>سندات صرف للموردين (Dr الموردون · Cr نقدية/بنك).</CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">لا توجد سندات صرف بعد.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-start">الرقم</TableHead>
                  <TableHead className="text-start">التاريخ</TableHead>
                  <TableHead className="text-start">المورد</TableHead>
                  <TableHead className="text-start">الفاتورة</TableHead>
                  <TableHead className="text-start">الطريقة</TableHead>
                  <TableHead className="text-start">المبلغ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono">{r.number}</TableCell>
                    <TableCell>{dt(r.date)}</TableCell>
                    <TableCell>{r.supplier ?? "—"}</TableCell>
                    <TableCell className="font-mono">{r.invoice ?? "تحت الحساب"}</TableCell>
                    <TableCell>{METHOD[r.method] ?? r.method}</TableCell>
                    <TableCell>{fmt(r.amount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
