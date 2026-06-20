"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { Plus, Pencil, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { saveItemAction, deleteItemAction, type ActionState } from "@/app/actions/erp/items";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export type Item = {
  id: string; code: string; nameAr: string | null; sellPrice: string | null; minStock: string | null; isActive: boolean;
};

const fmt = (v: string | null) => Number(v ?? 0).toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function SubmitBtn() {
  const { pending } = useFormStatus();
  return <Button type="submit" disabled={pending}>{pending && <Loader2 className="size-4 animate-spin" />}حفظ</Button>;
}

function ItemDialog({ open, onOpenChange, editing }: { open: boolean; onOpenChange: (o: boolean) => void; editing: Item | null }) {
  const [state, formAction] = useActionState<ActionState, FormData>(saveItemAction, {});
  useEffect(() => {
    if (state.ok) { toast.success("تم الحفظ"); onOpenChange(false); }
    else if (state.error) toast.error(state.error);
  }, [state, onOpenChange]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form action={formAction} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{editing ? "تعديل صنف" : "صنف جديد"}</DialogTitle>
            <DialogDescription>بيانات الصنف للمؤسسة النشطة.</DialogDescription>
          </DialogHeader>
          {editing && <input type="hidden" name="id" value={editing.id} />}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2"><Label htmlFor="i-code">الكود</Label><Input id="i-code" name="code" defaultValue={editing?.code} required /></div>
            <div className="space-y-2"><Label htmlFor="i-name">اسم الصنف</Label><Input id="i-name" name="nameAr" defaultValue={editing?.nameAr ?? ""} required /></div>
            <div className="space-y-2"><Label htmlFor="i-price">سعر البيع</Label><Input id="i-price" name="sellPrice" type="number" step="0.01" defaultValue={editing?.sellPrice ?? "0"} /></div>
            <div className="space-y-2"><Label htmlFor="i-min">الحد الأدنى</Label><Input id="i-min" name="minStock" type="number" step="0.01" defaultValue={editing?.minStock ?? "0"} /></div>
          </div>
          <DialogFooter><SubmitBtn /></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ItemsManager({ items, canManage }: { items: Item[]; canManage: boolean }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Item | null>(null);
  const [pending, startTransition] = useTransition();

  const remove = (it: Item) => startTransition(async () => {
    const r = await deleteItemAction(it.id);
    if (r.ok) toast.success("تم الحذف"); else toast.error(r.error ?? "تعذّر الحذف");
  });

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div><CardTitle>الأصناف</CardTitle><CardDescription>أصناف المخزون للمؤسسة النشطة.</CardDescription></div>
        {canManage && <Button onClick={() => { setEditing(null); setOpen(true); }}><Plus className="size-4" />صنف جديد</Button>}
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">لا توجد أصناف بعد.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-start">الكود</TableHead>
                <TableHead className="text-start">اسم الصنف</TableHead>
                <TableHead className="text-start">سعر البيع</TableHead>
                <TableHead className="text-start">حد أدنى</TableHead>
                {canManage && <TableHead className="text-start">إجراءات</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((it) => (
                <TableRow key={it.id}>
                  <TableCell className="font-mono">{it.code}</TableCell>
                  <TableCell>{it.nameAr ?? "—"}</TableCell>
                  <TableCell>{fmt(it.sellPrice)}</TableCell>
                  <TableCell>{fmt(it.minStock)}</TableCell>
                  {canManage && (
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" onClick={() => { setEditing(it); setOpen(true); }} aria-label="تعديل"><Pencil className="size-4" /></Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild><Button variant="ghost" size="icon" disabled={pending} aria-label="حذف"><Trash2 className="size-4 text-destructive" /></Button></AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader><AlertDialogTitle>حذف الصنف «{it.nameAr}»؟</AlertDialogTitle><AlertDialogDescription>لا يمكن التراجع.</AlertDialogDescription></AlertDialogHeader>
                            <AlertDialogFooter><AlertDialogCancel>إلغاء</AlertDialogCancel><AlertDialogAction onClick={() => remove(it)}>حذف</AlertDialogAction></AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      <ItemDialog key={editing?.id ?? "new"} open={open} onOpenChange={setOpen} editing={editing} />
    </Card>
  );
}
