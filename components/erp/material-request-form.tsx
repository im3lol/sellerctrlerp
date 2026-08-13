"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { createMaterialRequestAction, updateMaterialRequestAction } from "@/app/actions/erp/material-requests";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ItemPicker } from "@/components/erp/item-picker";
import { BarcodeScan } from "@/components/erp/barcode-scan";
import type { ItemSearchResult } from "@/app/actions/erp/item-search";

type Item = { id: string; nameAr: string | null };
type Line = { itemId: string; quantity: number };
export type MaterialRequestInitial = { id: string; date: string; notes: string; lines: Line[] };

export function MaterialRequestForm({ items, orgName, initial }: { items: Item[]; orgName: string; initial?: MaterialRequestInitial }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const today = new Date().toISOString().slice(0, 10);
  const isEdit = !!initial?.id;
  const [date, setDate] = useState(initial?.date ?? today);
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [lines, setLines] = useState<Line[]>(initial?.lines?.length ? initial.lines : [{ itemId: "", quantity: 1 }]);

  const setLine = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const addLine = () => setLines((ls) => [...ls, { itemId: "", quantity: 1 }]);
  const removeLine = (i: number) => setLines((ls) => (ls.length > 1 ? ls.filter((_, idx) => idx !== i) : ls));

  // Scanned/typed code → bump an existing line or fill the first empty one (append if none).
  const addOrBumpItem = (item: ItemSearchResult) =>
    setLines((ls) => {
      const idx = ls.findIndex((l) => l.itemId === item.id);
      if (idx >= 0) return ls.map((l, i) => (i === idx ? { ...l, quantity: l.quantity + 1 } : l));
      const emptyIdx = ls.findIndex((l) => !l.itemId);
      if (emptyIdx >= 0) return ls.map((l, i) => (i === emptyIdx ? { itemId: item.id, quantity: 1 } : l));
      return [...ls, { itemId: item.id, quantity: 1 }];
    });

  const submit = () => {
    if (lines.some((l) => !l.itemId)) return toast.error("اختر الصنف في كل بند");
    start(async () => {
      const body = { date, notes, lines: lines.map((l) => ({ itemId: l.itemId, quantity: l.quantity })) };
      const r = isEdit ? await updateMaterialRequestAction(initial!.id, body) : await createMaterialRequestAction(body);
      if (r.ok) { toast.success(isEdit ? "تم حفظ التعديلات" : "تم حفظ طلب المواد (مسودة)"); router.push(r.id ? `/purchases/requisitions/${r.id}` : "/purchases/requisitions"); router.refresh(); }
      else toast.error(r.error ?? "تعذّر الحفظ");
    });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex w-full items-center justify-between gap-3">
          <CardTitle>بيانات طلب المواد</CardTitle>
          <div className="flex gap-2">
            <Button size="sm" onClick={submit} disabled={pending}>{pending && <Loader2 className="size-4 animate-spin" />}{isEdit ? "حفظ التعديلات" : "حفظ الطلب"}</Button>
            <Button variant="outline" size="sm" onClick={() => router.push(isEdit ? `/purchases/requisitions/${initial!.id}` : "/purchases/requisitions")}>إلغاء</Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="space-y-2"><Label>الشركة</Label><div className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm font-medium">{orgName}</div></div>
          <div className="space-y-2"><Label>التاريخ</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div className="space-y-2"><Label>ملاحظات</Label><Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="اختياري" /></div>
        </div>

        <div className="rounded-xl border bg-muted/30 p-4">
          <div className="space-y-2 sm:max-w-sm"><Label>مسح باركود</Label><BarcodeScan onScan={addOrBumpItem} /></div>
        </div>

        <div className="rounded-xl border">
          <Table>
            <TableHeader><TableRow><TableHead className="text-start">الصنف</TableHead><TableHead className="w-32 text-start">الكمية</TableHead><TableHead className="w-10" /></TableRow></TableHeader>
            <TableBody>
              {lines.map((l, i) => (
                <TableRow key={i}>
                  <TableCell><ItemPicker selectedLabel={items.find((it) => it.id === l.itemId)?.nameAr ?? ""} onSelect={(it) => setLine(i, { itemId: it.id })} /></TableCell>
                  <TableCell><Input type="number" step="1" min="1" value={l.quantity} onChange={(e) => setLine(i, { quantity: Math.max(0, Math.trunc(Number(e.target.value) || 0)) })} /></TableCell>
                  <TableCell><Button variant="ghost" size="icon" onClick={() => removeLine(i)} aria-label="حذف"><Trash2 className="size-4 text-destructive" /></Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <Button variant="outline" onClick={addLine}><Plus className="size-4" />إضافة بند</Button>
      </CardContent>
    </Card>
  );
}
