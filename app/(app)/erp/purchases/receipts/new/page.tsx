import Link from "next/link";
import { and, desc, eq, inArray } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { purchaseOrders, suppliers } from "@/db/schema";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Icon } from "@/components/icon";
import { ErpPageHeader } from "@/components/erp/page-header";

const dt = (d: Date) => new Date(d).toLocaleDateString("en-GB", { year: "numeric", month: "2-digit", day: "2-digit" });
const STATUS: Record<string, string> = { CONFIRMED: "مؤكّد", PARTIALLY_RECEIVED: "استلام جزئي" };

export default async function NewReceiptPage() {
  const { orgId } = await requireErpModule("purchases.view");

  const rows = await db
    .select({ id: purchaseOrders.id, number: purchaseOrders.number, date: purchaseOrders.date, status: purchaseOrders.status, supplier: suppliers.nameAr })
    .from(purchaseOrders)
    .leftJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
    .where(and(eq(purchaseOrders.organizationId, orgId), inArray(purchaseOrders.status, ["CONFIRMED", "PARTIALLY_RECEIVED"])))
    .orderBy(desc(purchaseOrders.date), desc(purchaseOrders.number));

  return (
    <div className="space-y-6">
      <ErpPageHeader icon="PackageCheck" title="إذن استلام جديد" subtitle="اختر أمر شراء مؤكّداً لاستلام بضاعته (كاملاً أو جزئياً)" backHref="/erp/purchases/receipts" />
      <Card>
        <CardHeader>
          <CardTitle>أوامر شراء قابلة للاستلام</CardTitle>
          <CardDescription>تظهر هنا الأوامر المؤكّدة أو المنفّذة جزئياً. اضغط «استلام» لإنشاء إذن استلام بالكميات المتبقّية.</CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">
              لا توجد أوامر قابلة للاستلام. أكّد أمر شراء أولاً من <Link href="/erp/purchases/orders" className="text-primary">أوامر الشراء</Link>.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-start">الرقم</TableHead>
                  <TableHead className="text-start">التاريخ</TableHead>
                  <TableHead className="text-start">المورد</TableHead>
                  <TableHead className="text-start">الحالة</TableHead>
                  <TableHead className="text-start"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Link href={`/erp/purchases/orders/${encodeURIComponent(r.number)}`} className="hover:text-primary">{r.number}</Link>
                    </TableCell>
                    <TableCell>{dt(r.date)}</TableCell>
                    <TableCell>{r.supplier ?? "—"}</TableCell>
                    <TableCell><Badge variant={r.status === "PARTIALLY_RECEIVED" ? "secondary" : "default"}>{STATUS[r.status] ?? r.status}</Badge></TableCell>
                    <TableCell>
                      <Button size="sm" variant="outline" asChild>
                        <Link href={`/erp/purchases/orders/${encodeURIComponent(r.number)}/receive`}><Icon name="PackageCheck" className="size-4" />استلام</Link>
                      </Button>
                    </TableCell>
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
