"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { convertDeliveryToInvoiceAction, getDeliveryInvoicePreviewAction, type DeliveryInvoicePreview } from "@/app/actions/erp/deliveries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Customer = { id: string; nameAr: string };
type BillableDelivery = { id: string; number: string; customerId: string | null; dateLabel: string };

const selectCls = "flex h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-sm";
const fmt = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtyf = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 3 });

export function SalesInvoiceFromDeliveryForm({
  orgName, customers, deliveries,
}: {
  orgName: string;
  customers: Customer[];
  deliveries: BillableDelivery[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [loading, startLoad] = useTransition();
  const today = new Date().toISOString().slice(0, 10);

  const [customerId, setCustomerId] = useState("");
  const [date, setDate] = useState(today);
  const [notes, setNotes] = useState("");
  const [deliveryId, setDeliveryId] = useState("");
  const [preview, setPreview] = useState<DeliveryInvoicePreview | null>(null);

  const customerDeliveries = useMemo(() => deliveries.filter((d) => d.customerId === customerId), [deliveries, customerId]);

  const onCustomer = (id: string) => { setCustomerId(id); setDeliveryId(""); setPreview(null); };

  const recall = (id: string) => {
    setDeliveryId(id);
    setPreview(null);
    if (!id) return;
    startLoad(async () => {
      const r = await getDeliveryInvoicePreviewAction(id);
      if (!r.ok || !r.preview) { toast.error(r.error ?? "تعذّر استدعاء التسليم"); return; }
      if (r.preview.lines.length === 0) { toast.message("لا توجد كميات قابلة للفوترة في هذا التسليم"); return; }
      setPreview(r.preview);
    });
  };

  const submit = () => {
    if (!customerId) return toast.error("اختر العميل");
    if (!deliveryId) return toast.error("استدعِ إذن تسليم أولاً");
    if (!preview || preview.lines.length === 0) return toast.error("لا توجد بنود للفوترة");
    start(async () => {
      const r = await convertDeliveryToInvoiceAction(deliveryId, date, notes || undefined);
      if (r.ok) {
        toast.success("تم حفظ الفاتورة (مسودة) — أكّدها لاعتمادها");
        router.push(r.invoiceId ? `/erp/sales/invoices/${r.invoiceId}` : "/erp/sales/invoices");
        router.refresh();
      } else toast.error(r.error ?? "تعذّر الحفظ");
    });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex w-full items-center justify-between gap-3">
          <CardTitle>بيانات فاتورة البيع</CardTitle>
          <div className="flex gap-2">
            <Button size="sm" onClick={submit} disabled={pending || !preview}>{pending && <Loader2 className="size-4 animate-spin" />}حفظ الفاتورة</Button>
            <Button variant="outline" size="sm" onClick={() => router.push("/erp/sales/invoices")}>إلغاء</Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label>الشركة</Label>
            <div className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm font-medium">{orgName}</div>
          </div>
          <div className="space-y-2">
            <Label>العميل</Label>
            <select className={selectCls} value={customerId} onChange={(e) => onCustomer(e.target.value)}>
              <option value="">— اختر —</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.nameAr}</option>)}
            </select>
          </div>
          <div className="space-y-2"><Label>تاريخ الفاتورة</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        </div>

        <div className="grid gap-4 rounded-xl border bg-muted/30 p-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>استدعاء إذن تسليم</Label>
            <select className={selectCls} value={deliveryId} disabled={!customerId || loading} onChange={(e) => recall(e.target.value)}>
              <option value="">{customerId ? "— اختر إذن تسليم —" : "اختر العميل أولاً"}</option>
              {customerDeliveries.map((d) => <option key={d.id} value={d.id}>{d.number} — {d.dateLabel}</option>)}
            </select>
          </div>
          <div className="flex items-end text-sm text-muted-foreground">
            {loading ? <span className="flex items-center gap-2"><Loader2 className="size-4 animate-spin" />جارٍ تحميل بنود التسليم…</span>
              : customerId && customerDeliveries.length === 0 ? "لا توجد إذون تسليم مؤكَّدة غير مفوترة لهذا العميل."
              : "تنزل أصناف التسليم وأسعارها من أمر البيع في الجدول."}
          </div>
        </div>

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
                <TableRow><TableCell colSpan={6} className="py-10 text-center text-muted-foreground">اختر العميل ثم استدعِ إذن تسليم لعرض البنود.</TableCell></TableRow>
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
