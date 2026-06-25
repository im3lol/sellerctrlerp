"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
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

/** Props can either supply items directly (for QZ Tray path)
 *  OR supply a printPageHref for the browser-print / PDF path. */
export function BarcodePrintButton({
  items,
  printPageHref,
}: {
  items: BarcodeItem[];
  printPageHref?: string;
}) {
  const [qzOpen, setQzOpen] = useState(false);
  const [printers, setPrinters] = useState<string[]>([]);
  const [selected, setSelected] = useState("");
  const [connecting, startConnect] = useTransition();
  const [printing, startPrint] = useTransition();

  const printable = items.filter((i) => i.barcode);
  const totalLabels = printable.reduce((s, i) => s + i.quantity, 0);

  if (printable.length === 0 && !printPageHref) return null;

  /* ── QZ Tray connect / disconnect ── */
  const connect = () => {
    startConnect(async () => {
      try {
        const list = await listPrinters();
        setPrinters(list);
        if (list.length > 0) setSelected(list[0]);
      } catch {
        toast.error("تعذّر الاتصال بـ QZ Tray — استخدم زر «طباعة/PDF» بدلاً عنه");
      }
    });
  };

  useEffect(() => {
    if (qzOpen) connect();
    else void disconnectQz();
  }, [qzOpen]);

  const printZpl = () => {
    if (!selected) { toast.error("اختر طابعة أولاً"); return; }
    startPrint(async () => {
      try {
        await printBarcodeLabels(selected, printable);
        toast.success(`تمت طباعة ${totalLabels} ملصق`);
        setQzOpen(false);
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : "تعذّرت الطباعة");
      }
    });
  };

  return (
    <div className="flex gap-1">
      {/* ── Primary: browser print / PDF ── */}
      {printPageHref && (
        <Button size="sm" variant="outline" asChild>
          <Link href={printPageHref} target="_blank">
            <Icon name="Tag" className="size-4" />طباعة باركود
          </Link>
        </Button>
      )}

      {/* ── Secondary: QZ Tray (thermal / ZPL) ── */}
      {printable.length > 0 && (
        <Dialog open={qzOpen} onOpenChange={setQzOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="ghost" title="طباعة ZPL عبر QZ Tray">
              <Icon name="Zap" className="size-4" />
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>طباعة ZPL عبر QZ Tray</DialogTitle>
              <DialogDescription>
                {printable.length} صنف · {totalLabels} ملصق إجمالاً
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="max-h-40 overflow-y-auto rounded-lg border divide-y text-sm">
                {printable.map((item, i) => (
                  <div key={i} className="flex items-center justify-between px-3 py-2">
                    <div>
                      <span className="font-mono text-xs text-muted-foreground">{item.itemCode}</span>
                      {" "}{item.itemName}
                    </div>
                    <div className="flex items-center gap-2 shrink-0 text-muted-foreground">
                      <span className="font-mono text-xs">{item.barcode}</span>
                      <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium">×{item.quantity}</span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="space-y-2">
                <Label>الطابعة</Label>
                {connecting ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Icon name="Loader2" className="size-4 animate-spin" />البحث عن الطابعات...
                  </div>
                ) : printers.length === 0 ? (
                  <div className="space-y-1">
                    <p className="text-sm text-destructive">QZ Tray غير مشغّل.</p>
                    <Button size="sm" variant="outline" onClick={connect}>
                      <Icon name="RefreshCw" className="size-4" />إعادة المحاولة
                    </Button>
                  </div>
                ) : (
                  <select value={selected} onChange={(e) => setSelected(e.target.value)}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm">
                    {printers.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                )}
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setQzOpen(false)}>إلغاء</Button>
              <Button onClick={printZpl} disabled={printing || !selected || printers.length === 0}>
                {printing ? <Icon name="Loader2" className="size-4 animate-spin" /> : <Icon name="Printer" className="size-4" />}
                طباعة
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
