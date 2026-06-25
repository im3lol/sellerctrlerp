"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { connectQz, listPrinters, printBarcodeLabels, disconnectQz } from "@/lib/qz-tray";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

export type BarcodeItem = {
  barcode: string;
  itemCode: string;
  itemName: string;
  quantity: number;
};

export function BarcodePrintButton({ items }: { items: BarcodeItem[] }) {
  const [open, setOpen] = useState(false);
  const [printers, setPrinters] = useState<string[]>([]);
  const [selected, setSelected] = useState("");
  const [connecting, startConnect] = useTransition();
  const [printing, startPrint] = useTransition();

  const printable = items.filter((i) => i.barcode);

  if (printable.length === 0) return null;

  const connect = () => {
    startConnect(async () => {
      try {
        const list = await listPrinters();
        setPrinters(list);
        if (list.length > 0) setSelected(list[0]);
      } catch {
        toast.error("تعذّر الاتصال بـ QZ Tray — تأكد من تشغيله");
      }
    });
  };

  useEffect(() => {
    if (open) connect();
    else { void disconnectQz(); }
  }, [open]);

  const print = () => {
    if (!selected) { toast.error("اختر طابعة أولاً"); return; }
    startPrint(async () => {
      try {
        await printBarcodeLabels(selected, printable);
        toast.success(`تمت طباعة ${printable.reduce((s, i) => s + i.quantity, 0)} ملصق`);
        setOpen(false);
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : "تعذّرت الطباعة");
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Icon name="Tag" className="size-4" />طباعة باركود
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>طباعة ملصقات الباركود</DialogTitle>
          <DialogDescription>
            {printable.length} صنف · {printable.reduce((s, i) => s + i.quantity, 0)} ملصق إجمالاً
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Items preview */}
          <div className="max-h-48 overflow-y-auto rounded-lg border divide-y text-sm">
            {printable.map((item, i) => (
              <div key={i} className="flex items-center justify-between px-3 py-2">
                <div>
                  <span className="font-mono text-xs text-muted-foreground">{item.itemCode}</span>
                  {" "}{item.itemName}
                </div>
                <div className="flex items-center gap-2 text-muted-foreground shrink-0">
                  <span className="font-mono text-xs">{item.barcode}</span>
                  <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium">×{item.quantity}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Printer selector */}
          <div className="space-y-2">
            <Label>الطابعة</Label>
            {connecting ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Icon name="Loader2" className="size-4 animate-spin" />جارٍ البحث عن الطابعات...
              </div>
            ) : printers.length === 0 ? (
              <div className="space-y-1">
                <p className="text-sm text-destructive">لم يتم العثور على طابعات — تأكد من تشغيل QZ Tray.</p>
                <Button size="sm" variant="outline" onClick={connect}>
                  <Icon name="RefreshCw" className="size-4" />إعادة المحاولة
                </Button>
              </div>
            ) : (
              <select
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm"
              >
                {printers.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            يتطلب تشغيل{" "}
            <a href="https://qz.io/download/" target="_blank" rel="noopener" className="underline">
              QZ Tray
            </a>
            {" "}على نفس الجهاز. كل صنف يُطبع بعدد الكميات الموجودة في الوثيقة.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
          <Button onClick={print} disabled={printing || !selected || printers.length === 0}>
            {printing ? <Icon name="Loader2" className="size-4 animate-spin" /> : <Icon name="Printer" className="size-4" />}
            طباعة
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
