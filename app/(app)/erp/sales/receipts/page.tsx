import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { requireErpModule, erpCan } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { receiptVouchers, customers, salesInvoices } from "@/db/schema";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Icon } from "@/components/icon";
import { ErpPageHeader } from "@/components/erp/page-header";
import { VoucherRowActions } from "@/components/erp/voucher-row-actions";

const fmt = (v: string | null) => Number(v ?? 0).toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dt = (d: Date) => new Date(d).toLocaleDateString("en-GB", { year: "numeric", month: "2-digit", day: "2-digit" });
const METHOD: Record<string, string> = { CASH: "نقدي", BANK: "تحويل بنكي", CARD: "بطاقة", CHEQUE: "شيك" };

export default async function ReceiptsPage() {
  const { orgId, role } = await requireErpModule("sales.view");
  const canManage = erpCan(role, "sales.collect");
  const rows = await db
    .select({
      id: receiptVouchers.id,
      number: receiptVouchers.number,
      date: receiptVouchers.date,
      amount: receiptVouchers.amount,
      method: receiptVouchers.paymentMethod,
      status: receiptVouchers.status,
      customer: customers.nameAr,
      invoice: salesInvoices.number,
    })
    .from(receiptVouchers)
    .leftJoin(customers, eq(customers.id, receiptVouchers.customerId))
    .leftJoin(salesInvoices, eq(salesInvoices.id, receiptVouchers.salesInvoiceId))
    .where(eq(receiptVouchers.organizationId, orgId))
    .orderBy(desc(receiptVouchers.date), desc(receiptVouchers.number));

  const total = rows.filter((r) => r.status === "POSTED").reduce((s, r) => s + Number(r.amount), 0);

  return (
    <div className="space-y-6">
      <ErpPageHeader
        icon="HandCoins"
        title="سندات القبض"
        subtitle={`${rows.length} سند — إجمالي ${fmt(String(total))}`}
        action={
          erpCan(role, "sales.collect") ? (
            <Button asChild>
              <Link href="/erp/sales/receipts/new"><Icon name="Plus" className="size-4" />سند قبض</Link>
            </Button>
          ) : undefined
        }
      />
      <Card>
        <CardHeader>
          <CardTitle>التحصيلات</CardTitle>
          <CardDescription>سندات قبض من العملاء (Dr نقدية/بنك · Cr العملاء).</CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">لا توجد سندات قبض بعد.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-start">الرقم</TableHead>
                  <TableHead className="text-start">التاريخ</TableHead>
                  <TableHead className="text-start">العميل</TableHead>
                  <TableHead className="text-start">الفاتورة</TableHead>
                  <TableHead className="text-start">الطريقة</TableHead>
                  <TableHead className="text-start">المبلغ</TableHead>
                  <TableHead className="text-start">الحالة</TableHead>
                  {canManage && <TableHead className="text-start">إجراءات</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono">{r.number}</TableCell>
                    <TableCell>{dt(r.date)}</TableCell>
                    <TableCell>{r.customer ?? "—"}</TableCell>
                    <TableCell className="font-mono">{r.invoice ?? "تحت الحساب"}</TableCell>
                    <TableCell>{METHOD[r.method] ?? r.method}</TableCell>
                    <TableCell>{fmt(r.amount)}</TableCell>
                    <TableCell><Badge variant={r.status === "POSTED" ? "default" : "secondary"}>{r.status === "POSTED" ? "مرحّل" : "مسودة"}</Badge></TableCell>
                    {canManage && <TableCell><VoucherRowActions voucherId={r.id} type="receipt" status={r.status} canManage={canManage} /></TableCell>}
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
