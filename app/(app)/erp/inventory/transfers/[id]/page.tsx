import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { requireErpModule, erpCan } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { stockTransfers, stockTransferLines, items, warehouses, itemCodes } from "@/db/schema";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ErpPageHeader } from "@/components/erp/page-header";
import { StockRowActions } from "@/components/erp/stock-row-actions";
import { BarcodePrintButton } from "@/components/erp/barcode-print-button";

const q = (v: string | number | null) => Number(v ?? 0).toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 3 });
const dt = (d: Date) => new Date(d).toLocaleDateString("ar-EG-u-nu-latn", { year: "numeric", month: "2-digit", day: "2-digit" });

export default async function TransferDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { orgId, role } = await requireErpModule("inventory.view");
  const canManage = erpCan(role, "inventory.create");

  const [tr] = await db.select().from(stockTransfers)
    .where(and(eq(stockTransfers.id, id), eq(stockTransfers.organizationId, orgId))).limit(1);
  if (!tr) notFound();


  const fromWh = alias(warehouses, "from_wh");
  const toWh = alias(warehouses, "to_wh");
  const lines = await db
    .select({
      id: stockTransferLines.id,
      itemCode: items.code,
      itemName: items.nameAr,
      from: fromWh.nameAr,
      to: toWh.nameAr,
      quantity: stockTransferLines.quantity,
    })
    .from(stockTransferLines)
    .leftJoin(items, eq(items.id, stockTransferLines.itemId))
    .leftJoin(fromWh, eq(fromWh.id, stockTransferLines.fromWarehouseId))
    .leftJoin(toWh, eq(toWh.id, stockTransferLines.toWarehouseId))
    .where(eq(stockTransferLines.stockTransferId, id))
    .orderBy(asc(items.code));

  const lineItemIds = lines.map((l) => l.id).filter(Boolean) as string[];
  const barcodeRows = lineItemIds.length
    ? await db.select({ itemId: itemCodes.itemId, barcode: itemCodes.code }).from(itemCodes).where(eq(itemCodes.isPrimary, true))
    : [];
  const barcodeMap = Object.fromEntries(barcodeRows.map((r) => [r.itemId, r.barcode]));

  // Map transfer lines: use itemId from stockTransferLines
  const transferBarcodeItems = await (async () => {
    const fullLines = await db
      .select({ itemId: stockTransferLines.itemId, quantity: stockTransferLines.quantity, itemCode: items.code, itemName: items.nameAr })
      .from(stockTransferLines)
      .leftJoin(items, eq(items.id, stockTransferLines.itemId))
      .where(eq(stockTransferLines.stockTransferId, id));
    return fullLines
      .filter((l) => l.itemId && barcodeMap[l.itemId])
      .map((l) => ({ barcode: barcodeMap[l.itemId!]!, itemCode: l.itemCode ?? "", itemName: l.itemName ?? "", quantity: Math.max(1, Math.round(Number(l.quantity ?? 1))) }));
  })();

  const isDraft = tr.status === "DRAFT";

  return (
    <div className="space-y-6">
      <ErpPageHeader
        icon="ArrowLeftRight"
        title={`تحويل مخزني ${tr.number}`}
        subtitle={tr.notes ?? "نقل بين المستودعات"}
        backHref="/erp/inventory/transfers"
        action={
          <div className="flex gap-2">
            <BarcodePrintButton items={transferBarcodeItems} printPageHref={`/erp/barcodes/transfer/${tr.id}`} />
            {canManage && isDraft && <StockRowActions docId={tr.id} type="transfer" status={tr.status} canManage={canManage} dest="/erp/inventory/transfers" />}
          </div>
        }
      />

      <Card>
        <CardHeader><CardTitle>بيانات التحويل</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-4 text-sm">
          <div><div className="text-muted-foreground">الرقم</div><div className="font-mono font-medium">{tr.number}</div></div>
          <div><div className="text-muted-foreground">التاريخ</div><div className="font-medium">{dt(tr.date)}</div></div>
          <div><div className="text-muted-foreground">ملاحظات</div><div className="font-medium">{tr.notes ?? "—"}</div></div>
          <div><div className="text-muted-foreground">الحالة</div><Badge variant={tr.status === "POSTED" ? "default" : "secondary"}>{tr.status === "POSTED" ? "مرحّل" : "مسودة"}</Badge></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>الأصناف</CardTitle>
          <CardDescription>{isDraft ? "لم تُرحّل بعد — أكّد التحويل لتنفيذ النقل المخزني." : "تم النقل المخزني."}</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-start">الصنف</TableHead>
                <TableHead className="text-start">من مستودع</TableHead>
                <TableHead className="text-start">إلى مستودع</TableHead>
                <TableHead className="text-start">الكمية</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((l) => (
                <TableRow key={l.id}>
                  <TableCell><span className="font-mono text-xs text-muted-foreground">{l.itemCode}</span> {l.itemName}</TableCell>
                  <TableCell>{l.from ?? "—"}</TableCell>
                  <TableCell>{l.to ?? "—"}</TableCell>
                  <TableCell>{q(l.quantity)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
