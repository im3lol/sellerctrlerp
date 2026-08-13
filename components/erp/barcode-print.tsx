"use client";

import { useEffect, useState } from "react";
import JsBarcode from "jsbarcode";
import { toast } from "sonner";
import { Printer, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { selectCls } from "@/lib/utils";

export type PrintCode = { label: string; value: string };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Print a 50×25mm barcode label for one of the item's codes (SKU/ASIN/FNSKU/…)
 * through QZ Tray: pick the code + printer + copies, see a live preview of the
 * exact label, then print. The preview SVG (Code128 via JsBarcode) is serialized
 * verbatim into the printed HTML, so what you see is what prints.
 */
export function BarcodePrintButton({ itemName, codes }: { itemName: string; codes: PrintCode[] }) {
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(0);
  const [copies, setCopies] = useState(1);
  const [printers, setPrinters] = useState<string[]>([]);
  const [printer, setPrinter] = useState("");
  const [qzOk, setQzOk] = useState<boolean | null>(null); // null = probing
  const [busy, setBusy] = useState(false);
  // Callback-ref as state: fires when the <svg> actually mounts (Radix mounts the
  // dialog body in a portal a tick after `open` flips, so a plain ref is still null
  // on first open → the barcode wouldn't draw until you switched codes). Keying the
  // effect on the node itself removes that race.
  const [svgEl, setSvgEl] = useState<SVGSVGElement | null>(null);
  const value = codes[sel]?.value ?? "";

  // Live preview — regenerate the barcode whenever the svg mounts or the code changes.
  useEffect(() => {
    if (!svgEl || !value) return;
    try {
      JsBarcode(svgEl, value, { format: "CODE128", displayValue: false, margin: 0, height: 40, width: 2 });
    } catch { /* a value Code128 can't encode — preview stays stale; print is still gated on qz */ }
  }, [svgEl, value]);

  // Connect to the local QZ Tray app + list printers when the dialog opens.
  useEffect(() => {
    if (!open) return;
    setQzOk(null);
    void (async () => {
      try {
        const qz = (await import("qz-tray")).default;
        if (!qz.websocket.isActive()) await qz.websocket.connect({ retries: 1, delay: 1 });
        const found = await qz.printers.find();
        const list = (Array.isArray(found) ? found : [found]).map(String);
        setPrinters(list);
        try { setPrinter(String(await qz.printers.getDefault())); } catch { setPrinter(list[0] ?? ""); }
        setQzOk(true);
      } catch {
        setPrinters([]);
        setQzOk(false);
      }
    })();
  }, [open]);

  // The printed page: exactly the 50×25mm label, embedding the preview SVG as-is.
  const labelHtml = () => {
    const svg = svgEl ? new XMLSerializer().serializeToString(svgEl) : "";
    // Horizontal padding = the barcode's QUIET ZONE: bars must NOT reach the label edges
    // or a scanner can't read them. Content sits centered in ~40mm with ~5mm clear each side.
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
@page{size:50mm 25mm;margin:0}*{margin:0;padding:0;box-sizing:border-box}
body{width:50mm;height:25mm;padding:1.5mm 5mm;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0.8mm;font-family:Arial,sans-serif;overflow:hidden}
.n{font-size:6pt;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:center}
svg{width:100%;height:12mm}
.c{font-size:7.5pt;letter-spacing:1px;font-family:monospace}
</style></head><body><div class="n">${esc(itemName)}</div>${svg}<div class="c">${esc(value)}</div></body></html>`;
  };

  const print = async () => {
    if (!value) { toast.error("اختر الكود أولًا"); return; }
    if (!printer) { toast.error("اختر الطابعة"); return; }
    setBusy(true);
    try {
      const qz = (await import("qz-tray")).default;
      if (!qz.websocket.isActive()) await qz.websocket.connect({ retries: 1, delay: 1 });
      const cfg = qz.configs.create(printer, { units: "mm", size: { width: 50, height: 25 }, margins: 0, copies: Math.max(1, Math.min(100, copies)) });
      await qz.print(cfg, [{ type: "pixel", format: "html", flavor: "plain", data: labelHtml() }]);
      toast.success(`أُرسلت ${copies} ملصق للطابعة`);
      setOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "فشلت الطباعة — تأكد أن QZ Tray يعمل");
    } finally {
      setBusy(false);
    }
  };

  if (!codes.length) return null;

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Printer className="size-4" />طباعة الباركود
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>طباعة باركود — {itemName}</DialogTitle>
            <DialogDescription>ملصق 50×25 مم عبر QZ Tray — اختر الكود وشاهد المعاينة قبل الطباعة.</DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">الكود</label>
              <select className={selectCls} value={sel} onChange={(e) => setSel(Number(e.target.value))}>
                {codes.map((c, i) => <option key={i} value={i}>{c.label} — {c.value}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">عدد الملصقات</label>
              <input type="number" min={1} max={100} value={copies} onChange={(e) => setCopies(Math.max(1, Math.trunc(Number(e.target.value) || 1)))} className="block h-9 w-full rounded-md border bg-background px-3 text-sm" dir="ltr" />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">الطابعة</label>
            {qzOk === false ? (
              <p className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">تعذّر الاتصال بـ QZ Tray — تأكد أن البرنامج يعمل على هذا الجهاز ثم أعد فتح النافذة.</p>
            ) : (
              <select className={selectCls} value={printer} onChange={(e) => setPrinter(e.target.value)} disabled={qzOk === null}>
                {qzOk === null && <option>جاري الاتصال بـ QZ Tray…</option>}
                {printers.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            )}
          </div>

          {/* Live preview: same proportions as the physical 50×25mm label (2:1). */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">معاينة الملصق</label>
            {/* px-[10%] mirrors the printed label's 5mm/50mm quiet zone so the preview matches. */}
            <div className="mx-auto flex w-64 flex-col items-center justify-center gap-0.5 overflow-hidden rounded-md border bg-white px-[10%] py-[6%] text-black shadow-sm" style={{ aspectRatio: "2 / 1" }} dir="ltr">
              <div className="max-w-full truncate text-[10px] leading-tight">{itemName}</div>
              <svg ref={setSvgEl} className="h-10 w-full" />
              <div className="font-mono text-[11px] tracking-widest">{value}</div>
            </div>
          </div>

          <DialogFooter>
            <Button onClick={print} disabled={busy || qzOk !== true}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Printer className="size-4" />}طباعة
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
