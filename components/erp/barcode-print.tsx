"use client";

import { useEffect, useState } from "react";
import JsBarcode from "jsbarcode";
import { toast } from "sonner";
import { Printer, Loader2, Trash2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { selectCls } from "@/lib/utils";

export type PrintCode = { label: string; value: string };
/** One document line to print labels for: name + how many labels (line qty) + the codes to pick from. */
export type BulkRow = { itemName: string; qty: number; codes: PrintCode[] };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Render a Code128 barcode to a detached <svg> and serialize it — no DOM mount / ref
// needed, so it works for the bulk case where we generate many labels at print time.
function barcodeSvg(value: string): string {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  try { JsBarcode(svg, value, { format: "CODE128", displayValue: false, margin: 0, height: 40, width: 2 }); }
  catch { return ""; } // a value Code128 can't encode → label prints text-only
  return new XMLSerializer().serializeToString(svg);
}

// The printed 50×25mm label. Horizontal padding = the barcode's QUIET ZONE: bars must
// NOT reach the label edges or a scanner can't read them (~40mm content, ~5mm each side).
function labelDoc(itemName: string, value: string, svgMarkup: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
@page{size:50mm 25mm;margin:0}*{margin:0;padding:0;box-sizing:border-box}
body{width:50mm;height:25mm;padding:1.5mm 5mm;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0.8mm;font-family:Arial,sans-serif;overflow:hidden}
.n{font-size:6pt;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:center}
svg{width:100%;height:12mm}
.c{font-size:7.5pt;letter-spacing:1px;font-family:monospace}
</style></head><body><div class="n">${esc(itemName)}</div>${svgMarkup}<div class="c">${esc(value)}</div></body></html>`;
}

// Connect to the local QZ Tray app + list printers when a dialog opens.
function useQzPrinters(open: boolean) {
  const [printers, setPrinters] = useState<string[]>([]);
  const [printer, setPrinter] = useState("");
  const [qzOk, setQzOk] = useState<boolean | null>(null); // null = probing
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
      } catch { setPrinters([]); setQzOk(false); }
    })();
  }, [open]);
  return { printers, printer, setPrinter, qzOk };
}

// Send one QZ print job per physical label (jobs already expanded by quantity).
async function qzPrint(printer: string, jobs: { itemName: string; value: string }[]) {
  const qz = (await import("qz-tray")).default;
  if (!qz.websocket.isActive()) await qz.websocket.connect({ retries: 1, delay: 1 });
  const cfg = qz.configs.create(printer, { units: "mm", size: { width: 50, height: 25 }, margins: 0, copies: 1 });
  const data = jobs.map((j) => ({ type: "pixel", format: "html", flavor: "plain", data: labelDoc(j.itemName, j.value, barcodeSvg(j.value)) }));
  await qz.print(cfg, data);
}

function PrinterField({ qzOk, printers, printer, setPrinter }: { qzOk: boolean | null; printers: string[]; printer: string; setPrinter: (p: string) => void }) {
  return (
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
  );
}

// Small live preview mirroring the printed 50×25mm label (2:1). Callback-ref as state so
// it draws as soon as the <svg> mounts (Radix portals the dialog body a tick after open).
function LabelPreview({ itemName, value }: { itemName: string; value: string }) {
  const [svgEl, setSvgEl] = useState<SVGSVGElement | null>(null);
  useEffect(() => {
    if (!svgEl || !value) return;
    try { JsBarcode(svgEl, value, { format: "CODE128", displayValue: false, margin: 0, height: 40, width: 2 }); } catch { /* keep stale */ }
  }, [svgEl, value]);
  return (
    <div className="mx-auto flex w-64 flex-col items-center justify-center gap-0.5 overflow-hidden rounded-md border bg-white px-[10%] py-[6%] text-black shadow-sm" style={{ aspectRatio: "2 / 1" }} dir="ltr">
      <div className="max-w-full truncate text-[10px] leading-tight">{itemName}</div>
      <svg ref={setSvgEl} className="h-10 w-full" />
      <div className="font-mono text-[11px] tracking-widest">{value}</div>
    </div>
  );
}

/**
 * Single-item label: pick one of the item's codes + printer + copies, preview, print
 * via QZ Tray. Used on the item detail page.
 */
export function BarcodePrintButton({ itemName, codes }: { itemName: string; codes: PrintCode[] }) {
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(0);
  const [copies, setCopies] = useState(1);
  const [busy, setBusy] = useState(false);
  const { printers, printer, setPrinter, qzOk } = useQzPrinters(open);
  const value = codes[sel]?.value ?? "";

  const print = async () => {
    if (!value) { toast.error("اختر الكود أولًا"); return; }
    if (!printer) { toast.error("اختر الطابعة"); return; }
    setBusy(true);
    try {
      const n = Math.max(1, Math.min(100, copies));
      await qzPrint(printer, Array.from({ length: n }, () => ({ itemName, value })));
      toast.success(`أُرسلت ${n} ملصق للطابعة`);
      setOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "فشلت الطباعة — تأكد أن QZ Tray يعمل");
    } finally { setBusy(false); }
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

          <PrinterField qzOk={qzOk} printers={printers} printer={printer} setPrinter={setPrinter} />

          <div className="space-y-1.5">
            <label className="text-sm font-medium">معاينة الملصق</label>
            <LabelPreview itemName={itemName} value={value} />
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

type EditRow = BulkRow & { sel: number; include: boolean };
const seed = (rows: BulkRow[]): EditRow[] => rows.map((r) => ({ ...r, sel: 0, include: true }));

/**
 * Document-level bulk labels (goods receipt / issue note): one label per unit for every
 * line, quantity prefilled from the line. Before printing you can edit the quantity, drop
 * a line, pick one code for ALL lines, then override any line individually. Prints via QZ Tray.
 */
export function BulkBarcodePrintButton({ docTitle, rows }: { docTitle: string; rows: BulkRow[] }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<EditRow[]>(() => seed(rows));
  const { printers, printer, setPrinter, qzOk } = useQzPrinters(open);

  // Reset edits every time the dialog reopens (doc data is stable per mount).
  useEffect(() => { if (open) setEdit(seed(rows)); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const codeLabels = [...new Set(rows.flatMap((r) => r.codes.map((c) => c.label)))];
  const patch = (i: number, p: Partial<EditRow>) => setEdit((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...p } : r)));
  // Pick a code type for all lines that have it; lines without it keep their current pick.
  const applyGlobal = (label: string) => setEdit((rs) => rs.map((r) => {
    const i = r.codes.findIndex((c) => c.label === label);
    return i >= 0 ? { ...r, sel: i } : r;
  }));

  const included = edit.filter((r) => r.include && r.qty > 0 && r.codes[r.sel]?.value);
  const totalLabels = included.reduce((s, r) => s + r.qty, 0);
  const preview = included[0];

  const print = async () => {
    if (!printer) { toast.error("اختر الطابعة"); return; }
    if (!included.length) { toast.error("لا توجد أصناف للطباعة"); return; }
    setBusy(true);
    try {
      const jobs = included.flatMap((r) => Array.from({ length: r.qty }, () => ({ itemName: r.itemName, value: r.codes[r.sel].value })));
      await qzPrint(printer, jobs);
      toast.success(`أُرسل ${totalLabels} ملصق للطابعة`);
      setOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "فشلت الطباعة — تأكد أن QZ Tray يعمل");
    } finally { setBusy(false); }
  };

  if (!rows.length) return null;

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Printer className="size-4" />طباعة باركود
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent dir="rtl" className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>طباعة باركود — {docTitle}</DialogTitle>
            <DialogDescription>ملصق لكل قطعة حسب الكمية. عدّل الكمية أو استبعد صنفاً، واختر الكود للكل ثم عدّل أي صنف. 50×25 مم عبر QZ Tray.</DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">الكود لكل الأصناف</label>
              <select className={selectCls} defaultValue="" onChange={(e) => { if (e.target.value) applyGlobal(e.target.value); }}>
                <option value="">— اختر ثم عدّل أي صنف —</option>
                {codeLabels.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
            <PrinterField qzOk={qzOk} printers={printers} printer={printer} setPrinter={setPrinter} />
          </div>

          <div className="max-h-[42vh] overflow-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/60 text-xs">
                <tr>
                  <th className="p-2 text-start font-medium">الصنف</th>
                  <th className="p-2 text-start font-medium">الكود</th>
                  <th className="w-24 p-2 text-start font-medium">عدد الملصقات</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {edit.map((r, i) => (
                  <tr key={i} className={`border-t ${r.include ? "" : "opacity-40"}`}>
                    <td className="max-w-[200px] p-2"><div className="line-clamp-2 leading-snug" title={r.itemName}>{r.itemName}</div></td>
                    <td className="p-2">
                      <select className={selectCls} value={r.sel} disabled={!r.include} onChange={(e) => patch(i, { sel: Number(e.target.value) })}>
                        {r.codes.map((c, ci) => <option key={ci} value={ci}>{c.label} — {c.value}</option>)}
                      </select>
                    </td>
                    <td className="p-2">
                      <input type="number" min={0} max={500} value={r.qty} disabled={!r.include} dir="ltr"
                        onChange={(e) => patch(i, { qty: Math.max(0, Math.min(500, Math.trunc(Number(e.target.value) || 0))) })}
                        className="h-8 w-20 rounded-md border bg-background px-2 text-sm" />
                    </td>
                    <td className="p-2">
                      <Button variant="ghost" size="icon" onClick={() => patch(i, { include: !r.include })} aria-label={r.include ? "استبعاد" : "إرجاع"}>
                        {r.include ? <Trash2 className="size-4 text-destructive" /> : <RotateCcw className="size-4 text-muted-foreground" />}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {preview && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium">معاينة (أول صنف)</label>
              <LabelPreview itemName={preview.itemName} value={preview.codes[preview.sel].value} />
            </div>
          )}

          <DialogFooter className="sm:items-center sm:justify-between">
            <span className="text-sm text-muted-foreground">{totalLabels} ملصق · {included.length} صنف</span>
            <Button onClick={print} disabled={busy || qzOk !== true || !totalLabels}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Printer className="size-4" />}طباعة
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
