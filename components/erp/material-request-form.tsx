"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { createMaterialRequestAction } from "@/app/actions/erp/material-requests";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ItemPicker } from "@/components/erp/item-picker";

type Item = { id: string; nameAr: string | null };
type Line = { itemId: string; quantity: number };

export function MaterialRequestForm({ items, orgName }: { items: Item[]; orgName: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([{ itemId: "", quantity: 1 }]);

  const setLine = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const addLine = () => setLines((ls) => [...ls, { itemId: "", quantity: 1 }]);
  const removeLine = (i: number) => setLines((ls) => (ls.length > 1 ? ls.filter((_, idx) => idx !== i) : ls));

  const submit = () => {
    if (lines.some((l) => !l.itemId)) return toast.error("اختر الصنف في كل بند");
    start(async () => {
      const r = await createMaterialRequestAction({ date, notes, lines: lines.map((l) => ({ itemId: l.itemId, quantity: l.quantity })) });
      if (r.ok) { toast.success("تم حفظ طلب المواد (مسودة)"); router.push(r.id ? `/purchases/requisitions/${r.id}` : "/purchases/requisitions"); router.refresh(); }
      else toast.error(r.error ?? "تعذّر الحفظ");
    });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex w-full items-center justify-between gap-3">
          <CardTitle>بيانات طلب المواد</CardTitle>
          <div className="flex gap-2">
            <Button size="sm" onClick={submit} disabled={pending}>{pending && <Loader2 className="size-4 animate-spin" />}حفظ الطلب</Button>
            <Button variant="outline" size="sm" onClick={() => router.push("/purchases/requisitions")}>إلغاء</Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="space-y-2"><Label>الشركة</Label><div className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm font-medium">{orgName}</div></div>
          <div className="space-y-2"><Label>التاريخ</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div className="space-y-2"><Label>ملاحظات</Label><Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="اختياري" /></div>
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
