"use client";

import { useState } from "react";
import { fill } from "@/lib/i18n";
import { useT } from "@/lib/i18n/client";
import { Trash2, Printer, Loader2 } from "lucide-react";
import { toast } from "@/lib/i18n/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ItemPicker } from "@/components/erp/item-picker";
import type { ItemSearchResult } from "@/app/actions/erp/item-search";
import { type PrintCode } from "@/components/erp/barcode-print";
import { printLabelBatch } from "@/lib/erp/browser-label-print";
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
  const t = useT();
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);

  const add = (it: ItemSearchResult) => setRows((rs) => (rs.some((r) => r.itemId === it.id) ? rs : [...rs, { itemId: it.id, label: it.name ?? it.id, qty: 1, codes: itemCodes(it), sel: 0 }]));
  const patch = (i: number, p: Partial<Row>) => setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...p } : r)));
  const remove = (i: number) => setRows((rs) => rs.filter((_, idx) => idx !== i));
  const total = rows.reduce((s, r) => s + Math.floor(Number(r.qty) || 0), 0);

  const print = async () => {
    const valid = rows.filter((r) => r.qty > 0 && r.codes[r.sel]?.value);
    if (!valid.length) return toast.error("أضف صنفاً واحداً على الأقل");
    if (total > 5000) return toast.error("الحد الأقصى للدفعة 5000 ملصق؛ قسّم الكمية على دفعات");
    setBusy(true);
    try {
      const jobs = valid.flatMap((r) => Array.from({ length: Math.floor(r.qty) }, () => ({ itemName: r.label, value: r.codes[r.sel].value })));
      await printLabelBatch(jobs);
      toast.success(fill(t("فُتحت نافذة الطباعة لدفعة من {0} ملصق"), [jobs.length]));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "تعذّر فتح نافذة الطباعة");
    } finally { setBusy(false); }
  };

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="space-y-2">
          <Label>{t("أضف صنفاً")}</Label>
          <ItemPicker selectedLabel="" onSelect={add} />
        </div>

        {rows.length > 0 && (
          <div className="rounded-xl border">
            <Table className="table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead className="text-start">{t("الصنف")}</TableHead>
                  <TableHead className="text-start">{t("الكود")}</TableHead>
                  <TableHead className="w-32 text-start">{t("عدد الملصقات")}</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r, i) => (
                  <TableRow key={r.itemId}>
                    <TableCell className="truncate font-medium" title={t(r.label)}>{t(r.label)}</TableCell>
                    <TableCell>
                      <select className={selectCls} value={r.sel} onChange={(e) => patch(i, { sel: Number(e.target.value) })}>
                        {r.codes.map((c, ci) => <option key={ci} value={ci}>{t(c.label)} — {c.value}</option>)}
                      </select>
                    </TableCell>
                    <TableCell><Input type="number" step="1" min="1" max="500" value={r.qty} onChange={(e) => patch(i, { qty: Math.max(0, Math.trunc(Number(e.target.value) || 0)) })} /></TableCell>
                    <TableCell><Button variant="ghost" size="icon" onClick={() => remove(i)} aria-label={t("حذف")}><Trash2 className="size-4 text-destructive" /></Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <div className="max-w-xs">
          <p className="text-xs leading-6 text-muted-foreground">{t("اختر الطابعة المثبتة من نافذة الطباعة. الدفعة كاملة في نافذة واحدة؛ المقاس والمحاذاة من إعدادات الطباعة على هذا المتصفح، وقياس الطباعة 100%.")}</p>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{rows.length ? fill(t("{0} ملصق"), [total]) : t("لم تُضف أصناف بعد")}</span>
          <Button onClick={print} disabled={!rows.length || busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Printer className="size-4" />}{t("طباعة الملصقات")}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">{t("طباعة الملصقات من المتصفح بدون QZ Tray أو برامج إضافية.")}</p>
      </CardContent>
    </Card>
  );
}

