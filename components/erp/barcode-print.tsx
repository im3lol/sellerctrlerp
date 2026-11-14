"use client";

import { useEffect, useState } from "react";
import { fill } from "@/lib/i18n";
import { useT } from "@/lib/i18n/client";
import JsBarcode from "jsbarcode";
import { printLabelBatch } from "@/lib/erp/browser-label-print";
import { toast } from "@/lib/i18n/toast";
import { Printer, Loader2, Trash2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { selectCls } from "@/lib/utils";

export type PrintCode = { label: string; value: string };
/** One document line to print labels for: name + how many labels (line qty) + the codes to pick from. */
export type BulkRow = { itemName: string; qty: number; codes: PrintCode[] };

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
 * Single-item label: pick one of the item's codes and copies, preview, print
 * via one browser dialog. Used on the item detail page.
 */
export function BarcodePrintButton({ itemName, codes }: { itemName: string; codes: PrintCode[] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(0);
  const [copies, setCopies] = useState(1);
  const [busy, setBusy] = useState(false);
  const value = codes[sel]?.value ?? "";

  const print = async () => {
    if (!value) { toast.error("اختر الكود أولًا"); return; }
    setBusy(true);
    try {
      const n = Math.max(1, Math.min(100, copies));
      await printLabelBatch(Array.from({ length: n }, () => ({ itemName, value })));
      toast.success(fill(t("فُتحت نافذة الطباعة لدفعة من {0} ملصق"), [n]));
      setOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "تعذّر فتح نافذة الطباعة");
    } finally { setBusy(false); }
  };

  if (!codes.length) return null;

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Printer className="size-4" />{t("طباعة الباركود")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("طباعة باركود —")} {itemName}</DialogTitle>
            <DialogDescription>{t("مقاس الملصق من إعدادات الطباعة لهذا المتصفح؛ اختر الكود والكمية ثم اطبع الدفعة.")}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">{t("الكود")}</label>
              <select className={selectCls} value={sel} onChange={(e) => setSel(Number(e.target.value))}>
                {codes.map((c, i) => <option key={i} value={i}>{t(c.label)} — {c.value}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">{t("عدد الملصقات")}</label>
              <input type="number" min={1} max={100} value={copies} onChange={(e) => setCopies(Math.max(1, Math.trunc(Number(e.target.value) || 1)))} className="block h-9 w-full rounded-md border bg-background px-3 text-sm" dir="ltr" />
            </div>
          </div>

          <p className="text-xs leading-6 text-muted-foreground">{t("اختر الطابعة المثبتة من نافذة الطباعة. الدفعة كاملة في نافذة واحدة؛ المقاس والمحاذاة من إعدادات الطباعة على هذا المتصفح، وقياس الطباعة 100%.")}</p>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">{t("معاينة الملصق")}</label>
            <LabelPreview itemName={itemName} value={value} />
          </div>

          <DialogFooter>
            <Button onClick={print} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Printer className="size-4" />}{t("طباعة")}
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
 * a line, pick one code for ALL lines, then override any line individually. Opens one browser print dialog for the complete batch.
 */
export function BulkBarcodePrintButton({
  docTitle,
  rows,
  open: openProp,
  onOpenChange,
  hideTrigger,
}: {
  docTitle: string;
  rows: BulkRow[];
  /** Controlled mode: let a caller (e.g. an «إجراءات» menu item) own the open state and
   *  drop the built-in trigger. Uncontrolled — the plain button — stays the default. */
  open?: boolean;
  onOpenChange?: (v: boolean) => void;
  hideTrigger?: boolean;
}) {
  const t = useT();
  const [openSelf, setOpenSelf] = useState(false);
  const open = openProp ?? openSelf;
  const setOpen = onOpenChange ?? setOpenSelf;
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<EditRow[]>(() => seed(rows));

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
  const totalLabels = included.reduce((s, r) => s + Math.floor(r.qty), 0);
  const preview = included[0];

  const print = async () => {
    if (!included.length) { toast.error("لا توجد أصناف للطباعة"); return; }
    if (totalLabels > 5000) return toast.error("الحد الأقصى للدفعة 5000 ملصق؛ قسّم الكمية على دفعات");
    setBusy(true);
    try {
      const jobs = included.flatMap((r) => Array.from({ length: Math.floor(r.qty) }, () => ({ itemName: r.itemName, value: r.codes[r.sel].value })));
      await printLabelBatch(jobs);
      toast.success(fill(t("فُتحت نافذة الطباعة لدفعة من {0} ملصق"), [totalLabels]));
      setOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "تعذّر فتح نافذة الطباعة");
    } finally { setBusy(false); }
  };

  if (!rows.length) return null;

  return (
    <>
      {!hideTrigger && (
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          <Printer className="size-4" />{t("طباعة باركود")}
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("طباعة باركود —")} {docTitle}</DialogTitle>
            <DialogDescription>{t("ملصق لكل قطعة حسب الكمية. عدّل الأصناف والأكواد، ثم اطبع كل الملصقات في دفعة واحدة.")}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">{t("الكود لكل الأصناف")}</label>
              <select className={selectCls} defaultValue="" onChange={(e) => { if (e.target.value) applyGlobal(e.target.value); }}>
                <option value="">{t("— اختر ثم عدّل أي صنف —")}</option>
                {codeLabels.map((l) => <option key={l} value={l}>{t(l)}</option>)}
              </select>
            </div>
            <p className="text-xs leading-6 text-muted-foreground">{t("اختر الطابعة المثبتة من نافذة الطباعة. الدفعة كاملة في نافذة واحدة؛ المقاس والمحاذاة من إعدادات الطباعة على هذا المتصفح، وقياس الطباعة 100%.")}</p>
          </div>

          <div className="max-h-[42vh] overflow-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/60 text-xs">
                <tr>
                  <th className="p-2 text-start font-medium">{t("الصنف")}</th>
                  <th className="p-2 text-start font-medium">{t("الكود")}</th>
                  <th className="w-24 p-2 text-start font-medium">{t("عدد الملصقات")}</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {edit.map((r, i) => (
                  <tr key={i} className={`border-t ${r.include ? "" : "opacity-40"}`}>
                    <td className="max-w-[200px] p-2"><div className="line-clamp-2 leading-snug" title={r.itemName}>{r.itemName}</div></td>
                    <td className="p-2">
                      <select className={selectCls} value={r.sel} disabled={!r.include} onChange={(e) => patch(i, { sel: Number(e.target.value) })}>
                        {r.codes.map((c, ci) => <option key={ci} value={ci}>{t(c.label)} — {c.value}</option>)}
                      </select>
                    </td>
                    <td className="p-2">
                      <input type="number" min={0} max={500} value={r.qty} disabled={!r.include} dir="ltr"
                        onChange={(e) => patch(i, { qty: Math.max(0, Math.min(500, Math.trunc(Number(e.target.value) || 0))) })}
                        className="h-8 w-20 rounded-md border bg-background px-2 text-sm" />
                    </td>
                    <td className="p-2">
                      <Button variant="ghost" size="icon" onClick={() => patch(i, { include: !r.include })} aria-label={r.include ? t("استبعاد") : t("إرجاع")}>
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
              <label className="text-sm font-medium">{t("معاينة (أول صنف)")}</label>
              <LabelPreview itemName={preview.itemName} value={preview.codes[preview.sel].value} />
            </div>
          )}

          <DialogFooter className="sm:items-center sm:justify-between">
            <span className="text-sm text-muted-foreground">{totalLabels} {t("ملصق ·")} {included.length} {t("صنف")}</span>
            <Button onClick={print} disabled={busy || !totalLabels}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Printer className="size-4" />}{t("طباعة")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
