import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { requireErpModule, erpCan } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { purchaseInvoices, suppliers } from "@/db/schema";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ErpPageHeader } from "@/components/erp/page-header";
import { PostPurchaseInvoiceButton } from "@/components/erp/post-purchase-invoice-button";
import { Icon } from "@/components/icon";

const STATUS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" }> = {
  DRAFT: { label: "مسودة", variant: "secondary" },
  POSTED: { label: "مرحّلة", variant: "default" },
  PAID: { label: "مدفوعة", variant: "default" },
  PARTIAL_PAID: { label: "مدفوعة جزئياً", variant: "secondary" },
  CANCELLED: { label: "ملغاة", variant: "destructive" },
};
const fmt = (v: string | null) => Number(v ?? 0).toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dt = (d: Date) => new Date(d).toLocaleDateString("en-GB", { year: "numeric", month: "2-digit", day: "2-digit" });

export default async function PurchaseInvoicesPage() {
  const { orgId, role } = await requireErpModule("purchases.view");
  const rows = await db
    .select({
      id: purchaseInvoices.id, number: purchaseInvoices.number, date: purchaseInvoices.date,
      status: purchaseInvoices.status, total: purchaseInvoices.totalAmount, balanceDue: purchaseInvoices.balanceDue,
      supplierName: suppliers.nameAr,
    })
    .from(purchaseInvoices)
    .leftJoin(suppliers, eq(purchaseInvoices.supplierId, suppliers.id))
    .where(eq(purchaseInvoices.organizationId, orgId))
    .orderBy(desc(purchaseInvoices.date));

  const canManage = erpCan(role, "purchases.create");
  const canPost = erpCan(role, "accounting.post");

  return (
    <div className="space-y-6">
      <ErpPageHeader icon="ReceiptText" title="فواتير الشراء" subtitle={`${rows.length} فاتورة`} />
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div><CardTitle>الفواتير</CardTitle><CardDescription>فواتير الشراء للمؤسسة النشطة.</CardDescription></div>
          {canManage && (
            <Button asChild>
              <Link href="/erp/purchases/invoices/new"><Icon name="Plus" className="size-4" />فاتورة جديدة</Link>
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">لا توجد فواتير بعد.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-start">الرقم</TableHead>
                  <TableHead className="text-start">التاريخ</TableHead>
                  <TableHead className="text-start">المورد</TableHead>
                  <TableHead className="text-start">الإجمالي</TableHead>
                  <TableHead className="text-start">المتبقّي</TableHead>
                  <TableHead className="text-start">الحالة</TableHead>
                  {canPost && <TableHead className="text-start">إجراءات</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const st = STATUS[r.status] ?? { label: r.status, variant: "secondary" as const };
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono"><Link href={`/erp/purchases/invoices/${encodeURIComponent(r.number)}`} className="text-primary underline">{r.number}</Link></TableCell>
                      <TableCell>{dt(r.date)}</TableCell>
                      <TableCell>{r.supplierName ?? "—"}</TableCell>
                      <TableCell>{fmt(r.total)}</TableCell>
                      <TableCell>{fmt(r.balanceDue)}</TableCell>
                      <TableCell><Badge variant={st.variant}>{st.label}</Badge></TableCell>
                      {canPost && <TableCell>{r.status === "DRAFT" && <PostPurchaseInvoiceButton id={r.id} />}</TableCell>}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
