"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { convertReceiptToInvoiceAction, getReceiptInvoicePreviewAction, type ReceiptInvoicePreview } from "@/app/actions/erp/goods-receipts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Supplier = { id: string; nameAr: string };
type BillableReceipt = { id: string; number: string; supplierId: string | null; dateLabel: string };

const selectCls = "flex h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-sm";
const fmt = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtyf = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 3 });

export function PurchaseInvoiceFromReceiptForm({
  orgName, suppliers, receipts,
}: {
  orgName: string;
  suppliers: Supplier[];
  receipts: BillableReceipt[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [loading, startLoad] = useTransition();
  const today = new Date().toISOString().slice(0, 10);

  const [supplierId, setSupplierId] = useState("");
  const [date, setDate] = useState(today);
  const [notes, setNotes] = useState("");
  const [receiptId, setReceiptId] = useState("");
  const [preview, setPreview] = useState<ReceiptInvoicePreview | null>(null);

  const supplierReceipts = useMemo(() => receipts.filter((r) => r.supplierId === supplierId), [receipts, supplierId]);

  const onSupplier = (id: string) => { setSupplierId(id); setReceiptId(""); setPreview(null); };

  const recall = (id: string) => {
    setReceiptId(id);
    setPreview(null);
    if (!id) return;
    startLoad(async () => {
      const r = await getReceiptInvoicePreviewAction(id);
      if (!r.ok || !r.preview) { toast.error(r.error ?? "تعذّر استدعاء الإذن"); return; }
      if (r.preview.lines.length === 0) { toast.message("لا توجد كميات قابلة للفوترة في هذا الإذن"); return; }
      setPreview(r.preview);
    });
  };

  const submit = () => {
    if (!supplierId) return toast.error("اختر المورد");
    if (!receiptId) return toast.error("استدعِ إذن استلام أولاً");
    if (!preview || preview.lines.length === 0) return toast.error("لا توجد بنود للفوترة");
    start(async () => {
      const r = await convertReceiptToInvoiceAction(receiptId, date, notes || undefined);
      if (r.ok) {
        toast.success("تم حفظ الفاتورة (مسودة) — رحّلها لاعتمادها");
        router.push(r.invoiceId ? `/erp/purchases/invoices/${r.invoiceId}` : "/erp/purchases/invoices");
        router.refresh();
      } else toast.error(r.error ?? "تعذّر الحفظ");
    });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex w-full items-center justify-between gap-3">
          <CardTitle>بيانات فاتورة الشراء</CardTitle>
          <div className="flex gap-2">
            <Button size="sm" onClick={submit} disabled={pending || !preview}>{pending && <Loader2 className="size-4 animate-spin" />}حفظ الفاتورة</Button>
            <Button variant="outline" size="sm" onClick={() => router.push("/erp/purchases/invoices")}>إلغاء</Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Section 1 — البيانات */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label>الشركة</Label>
            <div className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm font-medium">{orgName}</div>
          </div>
          <div className="space-y-2">
            <Label>المورد</Label>
            <select className={selectCls} value={supplierId} onChange={(e) => onSupplier(e.target.value)}>
              <option value="">— اختر —</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.nameAr}</option>)}
            </select>
          </div>
          <div className="space-y-2"><Label>تاريخ الفاتورة</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        </div>

        {/* Recall a confirmed, un-billed goods receipt for the chosen supplier */}
        <div className="grid gap-4 rounded-xl border bg-muted/30 p-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>استدعاء إذن استلام</Label>
            <select className={selectCls} value={receiptId} disabled={!supplierId || loading} onChange={(e) => recall(e.target.value)}>
              <option value="">{supplierId ? "— اختر إذن استلام —" : "اختر المورد أولاً"}</option>
              {supplierReceipts.map((r) => <option key={r.id} value={r.id}>{r.number} — {r.dateLabel}</option>)}
            </select>
          </div>
          <div className="flex items-end text-sm text-muted-foreground">
            {loading ? <span className="flex items-center gap-2"><Loader2 className="size-4 animate-spin" />جارٍ تحميل بنود الإذن…</span>
              : supplierId && supplierReceipts.length === 0 ? "لا توجد إذون استلام مؤكَّدة غير مفوترة لهذا المورد."
              : "تنزل أصناف الإذن وأسعارها من أمر الشراء في الجدول."}
          </div>
        </div>

        {/* Preview — بيانات الجدول (read-only) */}
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-start">المنتج</TableHead>
                <TableHead className="w-24 text-start">الكمية</TableHead>
                <TableHead className="w-28 text-start">السعر</TableHead>
                <TableHead className="w-28 text-start">الخصم</TableHead>
                <TableHead className="w-28 text-start">الضريبة</TableHead>
                <TableHead className="w-28 text-start">الإجمالي</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!preview ? (
                <TableRow><TableCell colSpan={6} className="py-10 text-center text-muted-foreground">اختر المورد ثم استدعِ إذن استلام لعرض البنود.</TableCell></TableRow>
              ) : preview.lines.map((l) => (
                <TableRow key={l.itemId}>
                  <TableCell><span className="font-mono text-muted-foreground">{l.code}</span> {l.name}</TableCell>
                  <TableCell>{qtyf(l.quantity)}</TableCell>
                  <TableCell>{fmt(l.unitPrice)}</TableCell>
                  <TableCell>{fmt(l.discountAmount)}</TableCell>
                  <TableCell>{fmt(l.taxAmount)}</TableCell>
                  <TableCell className="font-medium">{fmt(l.totalAmount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
            {preview && (
              <TableFooter>
                <TableRow className="font-bold"><TableCell colSpan={5}>الإجمالي</TableCell><TableCell>{fmt(preview.total)}</TableCell></TableRow>
              </TableFooter>
            )}
          </Table>
        </div>

        {preview && (
          <div className="flex flex-col items-end gap-1 text-sm">
            <div>الإجمالي الفرعي: <span className="font-medium">{fmt(preview.subtotal)}</span></div>
            <div>الخصم: <span className="font-medium">{fmt(preview.discount)}</span></div>
            <div>الضريبة: <span className="font-medium">{fmt(preview.tax)}</span></div>
            <div className="text-base font-bold text-primary">الإجمالي: {fmt(preview.total)}</div>
          </div>
        )}

        <div className="space-y-2"><Label>ملاحظات</Label><Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="اختياري" /></div>
      </CardContent>
    </Card>
  );
}
