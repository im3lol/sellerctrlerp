"use client";

import { useState } from "react";
import { Trash2, Printer, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ItemPicker } from "@/components/erp/item-picker";
import type { ItemSearchResult } from "@/app/actions/erp/item-search";
import { useQzPrinters, qzPrint, PrinterField, type PrintCode } from "@/components/erp/barcode-print";
import { selectCls } from "@/lib/utils";

// Same Arabic labels as the item detail page's code list.
const CODE_LABEL: Record<string, string> = { SKU: "SKU (كود المنصة)", ASIN: "ASIN", FNSKU: "FNSKU", UPC: "UPC", EAN: "EAN", NOON: "كود نون" };

function itemCodes(it: ItemSearchResult): PrintCode[] {
  const out: PrintCode[] = [];
  const seen = new Set<string>();
  const push = (label: string, value: string | null | undefined) => {
    const v = (value ?? "").trim();
    if (!v || seen.has(v)) return;
    seen.add(v);
    out.push({ label, value: v });
  };
  push("كود الصنف", it.code);
  for (const c of it.codes) push(CODE_LABEL[c.type] ?? c.type, c.code);
  return out;
}

type Row = { itemId: string; label: string; qty: number; codes: PrintCode[]; sel: number };

export function BarcodeLabelsPicker() {
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const { printers, printer, setPrinter, qzOk } = useQzPrinters(true);

  const add = (it: ItemSearchResult) => setRows((rs) => (rs.some((r) => r.itemId === it.id) ? rs : [...rs, { itemId: it.id, label: it.name ?? it.id, qty: 1, codes: itemCodes(it), sel: 0 }]));
  const patch = (i: number, p: Partial<Row>) => setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...p } : r)));
  const remove = (i: number) => setRows((rs) => rs.filter((_, idx) => idx !== i));
  const total = rows.reduce((s, r) => s + (Number(r.qty) || 0), 0);

  const print = async () => {
    const valid = rows.filter((r) => r.qty > 0 && r.codes[r.sel]?.value);
    if (!valid.length) return toast.error("أضف صنفاً واحداً على الأقل");
    if (!printer) return toast.error("اختر الطابعة");
    setBusy(true);
    try {
      const jobs = valid.flatMap((r) => Array.from({ length: r.qty }, () => ({ itemName: r.label, value: r.codes[r.sel].value })));
      await qzPrint(printer, jobs);
      toast.success(`أُرسل ${jobs.length} ملصق للطابعة`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "فشلت الطباعة — تأكد أن QZ Tray يعمل");
    } finally { setBusy(false); }
  };

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="space-y-2">
          <Label>أضف صنفاً</Label>
          <ItemPicker selectedLabel="" onSelect={add} />
        </div>

        {rows.length > 0 && (
          <div className="rounded-xl border">
            <Table className="table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead className="text-start">الصنف</TableHead>
                  <TableHead className="text-start">الكود</TableHead>
                  <TableHead className="w-32 text-start">عدد الملصقات</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r, i) => (
                  <TableRow key={r.itemId}>
                    <TableCell className="truncate font-medium" title={r.label}>{r.label}</TableCell>
                    <TableCell>
                      <select className={selectCls} value={r.sel} onChange={(e) => patch(i, { sel: Number(e.target.value) })}>
                        {r.codes.map((c, ci) => <option key={ci} value={ci}>{c.label} — {c.value}</option>)}
                      </select>
                    </TableCell>
                    <TableCell><Input type="number" step="1" min="1" max="500" value={r.qty} onChange={(e) => patch(i, { qty: Math.max(0, Math.trunc(Number(e.target.value) || 0)) })} /></TableCell>
                    <TableCell><Button variant="ghost" size="icon" onClick={() => remove(i)} aria-label="حذف"><Trash2 className="size-4 text-destructive" /></Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <div className="max-w-xs">
          <PrinterField qzOk={qzOk} printers={printers} printer={printer} setPrinter={setPrinter} />
        </div>

        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{rows.length ? `${total} ملصق` : "لم تُضف أصناف بعد"}</span>
          <Button onClick={print} disabled={!rows.length || busy || qzOk !== true}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Printer className="size-4" />}طباعة الملصقات
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">طباعة مباشرة عبر QZ Tray — ملصق 50×25 مم.</p>
      </CardContent>
    </Card>
  );
}
