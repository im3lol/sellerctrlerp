"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { Plus, Pencil, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { saveInvestorAction, deleteInvestorAction, type ActionState } from "@/app/actions/erp/investors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export type Investor = {
  id: string; code: string; fullName: string; phone: string | null; email: string | null; nationalId: string | null; status: string;
};

function SubmitBtn() {
  const { pending } = useFormStatus();
  return <Button type="submit" disabled={pending}>{pending && <Loader2 className="size-4 animate-spin" />}حفظ</Button>;
}

function InvestorDialog({ open, onOpenChange, editing }: { open: boolean; onOpenChange: (o: boolean) => void; editing: Investor | null }) {
  const [state, formAction] = useActionState<ActionState, FormData>(saveInvestorAction, {});
  useEffect(() => {
    if (state.ok) { toast.success("تم الحفظ"); onOpenChange(false); }
    else if (state.error) toast.error(state.error);
  }, [state, onOpenChange]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form action={formAction} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{editing ? "تعديل مستثمر" : "مستثمر جديد"}</DialogTitle>
            <DialogDescription>بيانات المستثمر للمؤسسة النشطة.</DialogDescription>
          </DialogHeader>
          {editing && <input type="hidden" name="id" value={editing.id} />}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2"><Label htmlFor="inv-code">الكود</Label><Input id="inv-code" name="code" defaultValue={editing?.code} required /></div>
            <div className="space-y-2"><Label htmlFor="inv-name">الاسم</Label><Input id="inv-name" name="fullName" defaultValue={editing?.fullName} required /></div>
            <div className="space-y-2"><Label htmlFor="inv-phone">الهاتف</Label><Input id="inv-phone" name="phone" defaultValue={editing?.phone ?? ""} dir="ltr" /></div>
            <div className="space-y-2"><Label htmlFor="inv-nid">الهوية</Label><Input id="inv-nid" name="nationalId" defaultValue={editing?.nationalId ?? ""} dir="ltr" /></div>
            <div className="space-y-2"><Label htmlFor="inv-email">البريد</Label><Input id="inv-email" name="email" type="email" defaultValue={editing?.email ?? ""} dir="ltr" /></div>
            <div className="space-y-2">
              <Label htmlFor="inv-status">الحالة</Label>
              <select id="inv-status" name="status" defaultValue={editing?.status ?? "active"}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm">
                <option value="active">نشط</option>
                <option value="inactive">غير نشط</option>
              </select>
            </div>
          </div>
          <DialogFooter><SubmitBtn /></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function InvestorsManager({ investors, canManage }: { investors: Investor[]; canManage: boolean }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Investor | null>(null);
  const [pending, startTransition] = useTransition();

  const remove = (inv: Investor) => startTransition(async () => {
    const r = await deleteInvestorAction(inv.id);
    if (r.ok) toast.success("تم الحذف"); else toast.error(r.error ?? "تعذّر الحذف");
  });

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div><CardTitle>قائمة المستثمرين</CardTitle><CardDescription>مستثمرو المؤسسة النشطة.</CardDescription></div>
        {canManage && <Button onClick={() => { setEditing(null); setOpen(true); }}><Plus className="size-4" />مستثمر جديد</Button>}
      </CardHeader>
      <CardContent>
        {investors.length === 0 ? (
          <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">لا يوجد مستثمرون بعد.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-start">الكود</TableHead>
                <TableHead className="text-start">الاسم</TableHead>
                <TableHead className="text-start">الهاتف</TableHead>
                <TableHead className="text-start">الحالة</TableHead>
                {canManage && <TableHead className="text-start">إجراءات</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {investors.map((inv) => (
                <TableRow key={inv.id}>
                  <TableCell className="font-mono">{inv.code}</TableCell>
                  <TableCell>{inv.fullName}</TableCell>
                  <TableCell dir="ltr" className="text-start">{inv.phone ?? "—"}</TableCell>
                  <TableCell><Badge variant={inv.status === "active" ? "default" : "secondary"}>{inv.status === "active" ? "نشط" : "غير نشط"}</Badge></TableCell>
                  {canManage && (
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" onClick={() => { setEditing(inv); setOpen(true); }} aria-label="تعديل"><Pencil className="size-4" /></Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild><Button variant="ghost" size="icon" disabled={pending} aria-label="حذف"><Trash2 className="size-4 text-destructive" /></Button></AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader><AlertDialogTitle>حذف المستثمر «{inv.fullName}»؟</AlertDialogTitle><AlertDialogDescription>لا يمكن التراجع.</AlertDialogDescription></AlertDialogHeader>
                            <AlertDialogFooter><AlertDialogCancel>إلغاء</AlertDialogCancel><AlertDialogAction onClick={() => remove(inv)}>حذف</AlertDialogAction></AlertDialogFooter>
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
      <InvestorDialog key={editing?.id ?? "new"} open={open} onOpenChange={setOpen} editing={editing} />
    </Card>
  );
}
