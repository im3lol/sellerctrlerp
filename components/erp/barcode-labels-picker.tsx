"use client";

import { useState } from "react";
import { Plus, Trash2, Printer } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ItemPicker } from "@/components/erp/item-picker";
import type { ItemSearchResult } from "@/app/actions/erp/item-search";

type Row = { itemId: string; label: string; qty: number };

export function BarcodeLabelsPicker() {
  const [rows, setRows] = useState<Row[]>([]);

  const add = (it: ItemSearchResult) => setRows((rs) => (rs.some((r) => r.itemId === it.id) ? rs : [...rs, { itemId: it.id, label: it.name ?? it.id, qty: 1 }]));
  const setQty = (i: number, qty: number) => setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, qty } : r)));
  const remove = (i: number) => setRows((rs) => rs.filter((_, idx) => idx !== i));
  const total = rows.reduce((s, r) => s + (Number(r.qty) || 0), 0);

  const print = () => {
    const valid = rows.filter((r) => r.itemId && r.qty > 0);
    if (!valid.length) return toast.error("أضف صنفاً واحداً على الأقل");
    const spec = valid.map((r) => `${r.itemId}:${Math.round(r.qty)}`).join(",");
    window.open(`/barcodes/batch?items=${encodeURIComponent(spec)}`, "_blank");
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
            <Table>
              <TableHeader><TableRow><TableHead className="text-start">الصنف</TableHead><TableHead className="w-32 text-start">عدد الملصقات</TableHead><TableHead className="w-10" /></TableRow></TableHeader>
              <TableBody>
                {rows.map((r, i) => (
                  <TableRow key={r.itemId}>
                    <TableCell className="font-medium">{r.label}</TableCell>
                    <TableCell><Input type="number" step="1" min="1" max="500" value={r.qty} onChange={(e) => setQty(i, Math.max(0, Math.trunc(Number(e.target.value) || 0)))} /></TableCell>
                    <TableCell><Button variant="ghost" size="icon" onClick={() => remove(i)} aria-label="حذف"><Trash2 className="size-4 text-destructive" /></Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{rows.length ? `${total} ملصق` : "لم تُضف أصناف بعد"}</span>
          <Button onClick={print} disabled={!rows.length}><Printer className="size-4" />طباعة الملصقات</Button>
        </div>
        <p className="text-xs text-muted-foreground">تُفتح صفحة طباعة بحجم ملصق 50×25 مم — استخدم «طباعة / حفظ PDF».</p>
      </CardContent>
    </Card>
  );
}
