import { and, eq, inArray, sql } from "drizzle-orm";
import Link from "next/link";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import {
  purchaseReceipts, purchaseReceiptLines, purchaseOrders, purchaseOrderLines,
  purchaseInvoices, purchaseInvoiceLines, suppliers,
} from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { scoreSuppliers, ratingLabel, type ReceiptFact, type PriceFact } from "@/lib/erp/vendor-rating";

const n1 = (v: number | null) => (v == null ? "—" : v.toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 1 }));
const pct = (v: number | null) => (v == null ? "—" : `${(v * 100).toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 1 })}%`);

const tone = (v: number | null) =>
  v == null ? "text-muted-foreground" : v >= 85 ? "text-emerald-600" : v >= 60 ? "text-amber-600" : "text-destructive";

export default async function SupplierRatingPage() {
  return loadErpPage("purchases.view", async ({ orgId }) => {
    // Delivery + quality, from confirmed receipts joined back to their order's promise.
    const receiptRows = await db
      .select({
        supplierId: purchaseReceipts.supplierId,
        receivedDate: purchaseReceipts.date,
        expectedDate: purchaseOrders.expectedDate,
        accepted: sql<string>`COALESCE(SUM(${purchaseReceiptLines.quantity}), 0)`,
        rejected: sql<string>`COALESCE(SUM(${purchaseReceiptLines.rejectedQty}), 0)`,
      })
      .from(purchaseReceipts)
      .leftJoin(purchaseOrders, eq(purchaseOrders.id, purchaseReceipts.purchaseOrderId))
      .leftJoin(purchaseReceiptLines, eq(purchaseReceiptLines.purchaseReceiptId, purchaseReceipts.id))
      .where(and(
        eq(purchaseReceipts.organizationId, orgId),
        inArray(purchaseReceipts.status, ["RECEIVED", "INVOICED"]),
      ))
      .groupBy(purchaseReceipts.id, purchaseReceipts.supplierId, purchaseReceipts.date, purchaseOrders.expectedDate);

    // Price honesty: what was invoiced against what the order agreed, per item.
    const priceRows = await db
      .select({
        supplierId: purchaseInvoices.supplierId,
        invoiced: purchaseInvoiceLines.unitPrice,
        ordered: purchaseOrderLines.unitPrice,
        quantity: purchaseInvoiceLines.quantity,
      })
      .from(purchaseInvoiceLines)
      .innerJoin(purchaseInvoices, eq(purchaseInvoices.id, purchaseInvoiceLines.purchaseInvoiceId))
      .innerJoin(purchaseReceipts, eq(purchaseReceipts.purchaseInvoiceId, purchaseInvoices.id))
      .innerJoin(purchaseOrderLines, and(
        eq(purchaseOrderLines.purchaseOrderId, purchaseReceipts.purchaseOrderId),
        eq(purchaseOrderLines.itemId, purchaseInvoiceLines.itemId),
      ))
      .where(and(
        eq(purchaseInvoices.organizationId, orgId),
        eq(purchaseInvoices.status, "POSTED"),
      ));

    const receiptFacts: ReceiptFact[] = receiptRows
      .filter((r) => r.supplierId)
      .map((r) => ({
        supplierId: r.supplierId!,
        expectedDate: r.expectedDate,
        receivedDate: r.receivedDate,
        acceptedQty: Number(r.accepted),
        rejectedQty: Number(r.rejected),
      }));

    const priceFacts: PriceFact[] = priceRows
      .filter((p) => p.supplierId)
      .map((p) => ({
        supplierId: p.supplierId!,
        orderedUnitPrice: Number(p.ordered),
        invoicedUnitPrice: Number(p.invoiced),
        quantity: Number(p.quantity),
      }));

    const scores = scoreSuppliers(receiptFacts, priceFacts);
    const names = new Map(
      (await db.select({ id: suppliers.id, nameAr: suppliers.nameAr, code: suppliers.code })
        .from(suppliers).where(eq(suppliers.organizationId, orgId)))
        .map((s) => [s.id, { name: s.nameAr, code: s.code }]),
    );

    const undated = receiptFacts.length > 0 && receiptFacts.every((r) => !r.expectedDate);

    return (
      <div className="space-y-6">
        <ErpPageHeader
          icon="Star"
          title="تقييم الموردين"
          subtitle="محسوب من أوامر الشراء والاستلامات والفواتير — مفيش أي إدخال بيانات إضافي"
          backHref="/purchases/suppliers"
        />

        <Card>
          <CardHeader>
            <CardTitle>كيف بيتحسب</CardTitle>
            <CardDescription>
              <b>الالتزام بالمواعيد (٤٠٪)</b> من فرق تاريخ الاستلام عن التسليم المتوقّع في الأمر ·{" "}
              <b>الجودة (٣٥٪)</b> من الكمية المرفوضة عند الاستلام ·{" "}
              <b>الالتزام بالسعر (٢٥٪)</b> من فرق سعر الفاتورة عن سعر الأمر.
              البُعد اللي مفيش بيانات ليه بيتشال من المعادلة، مش بيتحسب صفر — والمورّد بأقل من ٣ استلامات
              بيتعرض من غير تقدير، لأن عيّنة صغيرة مش حكم.
            </CardDescription>
          </CardHeader>
          {undated && (
            <CardContent>
              <p className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
                مفيش ولا أمر شراء متسجّل فيه «التسليم المتوقّع»، فدرجة المواعيد فاضية للكل.
                املا الحقل ده في أوامر الشراء الجاية والدرجة هتظهر لوحدها.
              </p>
            </CardContent>
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>الترتيب</CardTitle>
            <CardDescription>{scores.length ? `${scores.length} مورّد` : "مفيش بيانات كفاية بعد"}</CardDescription>
          </CardHeader>
          <CardContent>
            {scores.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                التقييم بيظهر بعد أول إذن استلام مؤكّد. مفيش حاجة تتملى هنا — الأرقام بتيجي من المستندات نفسها.
              </p>
            ) : (
              <div className="rounded-xl border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-start">المورّد</TableHead>
                      <TableHead className="text-start">التقدير</TableHead>
                      <TableHead className="text-start">الإجمالي</TableHead>
                      <TableHead className="text-start">المواعيد</TableHead>
                      <TableHead className="text-start">الجودة</TableHead>
                      <TableHead className="text-start">السعر</TableHead>
                      <TableHead className="text-start">متوسط التأخير</TableHead>
                      <TableHead className="text-start">نسبة الرفض</TableHead>
                      <TableHead className="text-start">العيّنة</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {scores.map((s) => {
                      const label = ratingLabel(s);
                      const sup = names.get(s.supplierId);
                      return (
                        <TableRow key={s.supplierId}>
                          <TableCell className="font-medium">
                            <Link className="hover:underline" href="/purchases/suppliers">{sup?.name ?? "—"}</Link>
                            <span className="block font-mono text-xs text-muted-foreground">{sup?.code ?? ""}</span>
                          </TableCell>
                          <TableCell>
                            {label ? <Badge variant={label === "ضعيف" ? "destructive" : "secondary"}>{label}</Badge>
                                   : <span className="text-xs text-muted-foreground">عيّنة صغيرة</span>}
                          </TableCell>
                          <TableCell className={`font-bold tabular-nums ${tone(s.overall)}`}>{n1(s.overall)}</TableCell>
                          <TableCell className={`tabular-nums ${tone(s.onTime)}`}>{n1(s.onTime)}</TableCell>
                          <TableCell className={`tabular-nums ${tone(s.quality)}`}>{n1(s.quality)}</TableCell>
                          <TableCell className={`tabular-nums ${tone(s.priceHonesty)}`}>{n1(s.priceHonesty)}</TableCell>
                          <TableCell className="tabular-nums">
                            {s.avgDaysLate == null ? "—" : `${n1(s.avgDaysLate)} يوم`}
                          </TableCell>
                          <TableCell className="tabular-nums">{pct(s.rejectRate)}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {s.sample.receipts} استلام · {s.sample.invoicedLines} بند مفوتر
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  });
}
