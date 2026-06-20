"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { Plus, Pencil, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { saveSupplierAction, deleteSupplierAction, type ActionState } from "@/app/actions/erp/suppliers";
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

export type Supplier = {
  id: string; code: string; nameAr: string; phone: string | null; balance: string | null; paymentTerms: number;
};

const fmt = (v: string | null) => Number(v ?? 0).toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function SubmitBtn() {
  const { pending } = useFormStatus();
  return <Button type="submit" disabled={pending}>{pending && <Loader2 className="size-4 animate-spin" />}حفظ</Button>;
}

function SupplierDialog({ open, onOpenChange, editing }: { open: boolean; onOpenChange: (o: boolean) => void; editing: Supplier | null }) {
  const [state, formAction] = useActionState<ActionState, FormData>(saveSupplierAction, {});
  useEffect(() => {
    if (state.ok) { toast.success("تم الحفظ"); onOpenChange(false); }
    else if (state.error) toast.error(state.error);
  }, [state, onOpenChange]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form action={formAction} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{editing ? "تعديل مورد" : "مورد جديد"}</DialogTitle>
            <DialogDescription>بيانات المورد للمؤسسة النشطة.</DialogDescription>
          </DialogHeader>
          {editing && <input type="hidden" name="id" value={editing.id} />}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2"><Label htmlFor="s-code">الكود</Label><Input id="s-code" name="code" defaultValue={editing?.code} required /></div>
            <div className="space-y-2"><Label htmlFor="s-name">الاسم</Label><Input id="s-name" name="nameAr" defaultValue={editing?.nameAr} required /></div>
            <div className="space-y-2"><Label htmlFor="s-phone">الهاتف</Label><Input id="s-phone" name="phone" defaultValue={editing?.phone ?? ""} dir="ltr" /></div>
            <div className="space-y-2"><Label htmlFor="s-terms">مدة السداد (يوم)</Label><Input id="s-terms" name="paymentTerms" type="number" defaultValue={editing?.paymentTerms ?? 30} /></div>
            <div className="space-y-2 col-span-2"><Label htmlFor="s-email">البريد</Label><Input id="s-email" name="email" type="email" dir="ltr" /></div>
          </div>
          <DialogFooter><SubmitBtn /></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function SuppliersManager({ suppliers, canManage }: { suppliers: Supplier[]; canManage: boolean }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [pending, startTransition] = useTransition();

  const remove = (s: Supplier) => startTransition(async () => {
    const r = await deleteSupplierAction(s.id);
    if (r.ok) toast.success("تم الحذف"); else toast.error(r.error ?? "تعذّر الحذف");
  });

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div><CardTitle>الموردون</CardTitle><CardDescription>موردو المؤسسة النشطة وأرصدتهم.</CardDescription></div>
        {canManage && <Button onClick={() => { setEditing(null); setOpen(true); }}><Plus className="size-4" />مورد جديد</Button>}
      </CardHeader>
      <CardContent>
        {suppliers.length === 0 ? (
          <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">لا يوجد موردون بعد.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-start">الكود</TableHead>
                <TableHead className="text-start">الاسم</TableHead>
                <TableHead className="text-start">الهاتف</TableHead>
                <TableHead className="text-start">الرصيد</TableHead>
                <TableHead className="text-start">مدة السداد</TableHead>
                {canManage && <TableHead className="text-start">إجراءات</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {suppliers.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-mono">{s.code}</TableCell>
                  <TableCell>{s.nameAr}</TableCell>
                  <TableCell dir="ltr" className="text-start">{s.phone ?? "—"}</TableCell>
                  <TableCell>{fmt(s.balance)}</TableCell>
                  <TableCell>{s.paymentTerms} يوم</TableCell>
                  {canManage && (
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" onClick={() => { setEditing(s); setOpen(true); }} aria-label="تعديل"><Pencil className="size-4" /></Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild><Button variant="ghost" size="icon" disabled={pending} aria-label="حذف"><Trash2 className="size-4 text-destructive" /></Button></AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader><AlertDialogTitle>حذف المورد «{s.nameAr}»؟</AlertDialogTitle><AlertDialogDescription>لا يمكن التراجع.</AlertDialogDescription></AlertDialogHeader>
                            <AlertDialogFooter><AlertDialogCancel>إلغاء</AlertDialogCancel><AlertDialogAction onClick={() => remove(s)}>حذف</AlertDialogAction></AlertDialogFooter>
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
      <SupplierDialog key={editing?.id ?? "new"} open={open} onOpenChange={setOpen} editing={editing} />
    </Card>
  );
}
