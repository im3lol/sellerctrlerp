"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { Plus, Pencil, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { saveAccountAction, deleteAccountAction, type ActionState } from "@/app/actions/erp/accounts";
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

export type Account = {
  id: string; code: string; nameAr: string; nameEn: string | null;
  type: string; normalBalance: string; isLeaf: boolean; isActive: boolean;
};

const TYPE_LABELS: Record<string, string> = {
  ASSET: "أصول", LIABILITY: "خصوم", EQUITY: "حقوق ملكية", REVENUE: "إيرادات", EXPENSE: "مصروفات",
};

const selectCls = "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm";

function SubmitBtn() {
  const { pending } = useFormStatus();
  return <Button type="submit" disabled={pending}>{pending && <Loader2 className="size-4 animate-spin" />}حفظ</Button>;
}

function AccountDialog({ open, onOpenChange, editing }: { open: boolean; onOpenChange: (o: boolean) => void; editing: Account | null }) {
  const [state, formAction] = useActionState<ActionState, FormData>(saveAccountAction, {});
  useEffect(() => {
    if (state.ok) { toast.success("تم الحفظ"); onOpenChange(false); }
    else if (state.error) toast.error(state.error);
  }, [state, onOpenChange]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form action={formAction} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{editing ? "تعديل حساب" : "حساب جديد"}</DialogTitle>
            <DialogDescription>حساب ضمن دليل حسابات المؤسسة النشطة.</DialogDescription>
          </DialogHeader>
          {editing && <input type="hidden" name="id" value={editing.id} />}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2"><Label htmlFor="a-code">الكود</Label><Input id="a-code" name="code" defaultValue={editing?.code} required /></div>
            <div className="space-y-2"><Label htmlFor="a-name">الاسم</Label><Input id="a-name" name="nameAr" defaultValue={editing?.nameAr} required /></div>
            <div className="space-y-2">
              <Label htmlFor="a-type">النوع</Label>
              <select id="a-type" name="type" defaultValue={editing?.type ?? "ASSET"} className={selectCls}>
                <option value="ASSET">أصول</option>
                <option value="LIABILITY">خصوم</option>
                <option value="EQUITY">حقوق ملكية</option>
                <option value="REVENUE">إيرادات</option>
                <option value="EXPENSE">مصروفات</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="a-nb">الطبيعة</Label>
              <select id="a-nb" name="normalBalance" defaultValue={editing?.normalBalance ?? "DEBIT"} className={selectCls}>
                <option value="DEBIT">مدين</option>
                <option value="CREDIT">دائن</option>
              </select>
            </div>
          </div>
          <div className="flex gap-6">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isLeaf" defaultChecked={editing ? editing.isLeaf : true} />حساب تفصيلي</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isActive" defaultChecked={editing ? editing.isActive : true} />نشط</label>
          </div>
          <DialogFooter><SubmitBtn /></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function AccountsManager({ accounts, canManage }: { accounts: Account[]; canManage: boolean }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  const [pending, startTransition] = useTransition();

  const remove = (a: Account) => startTransition(async () => {
    const r = await deleteAccountAction(a.id);
    if (r.ok) toast.success("تم الحذف"); else toast.error(r.error ?? "تعذّر الحذف");
  });

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div><CardTitle>دليل الحسابات</CardTitle><CardDescription>الحسابات المالية للمؤسسة النشطة.</CardDescription></div>
        {canManage && <Button onClick={() => { setEditing(null); setOpen(true); }}><Plus className="size-4" />حساب جديد</Button>}
      </CardHeader>
      <CardContent>
        {accounts.length === 0 ? (
          <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">لا توجد حسابات بعد.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-start">الكود</TableHead>
                <TableHead className="text-start">اسم الحساب</TableHead>
                <TableHead className="text-start">النوع</TableHead>
                <TableHead className="text-start">الطبيعة</TableHead>
                <TableHead className="text-start">الحالة</TableHead>
                {canManage && <TableHead className="text-start">إجراءات</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.map((a) => (
                <TableRow key={a.id} className={a.isLeaf ? "" : "bg-muted/30 font-semibold"}>
                  <TableCell className="font-mono">{a.code}</TableCell>
                  <TableCell>{a.nameAr}</TableCell>
                  <TableCell><Badge variant="secondary">{TYPE_LABELS[a.type] ?? a.type}</Badge></TableCell>
                  <TableCell>{a.normalBalance === "DEBIT" ? "مدين" : "دائن"}</TableCell>
                  <TableCell>{a.isActive ? <span className="text-primary">نشط</span> : <span className="text-muted-foreground">معطّل</span>}</TableCell>
                  {canManage && (
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" onClick={() => { setEditing(a); setOpen(true); }} aria-label="تعديل"><Pencil className="size-4" /></Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild><Button variant="ghost" size="icon" disabled={pending} aria-label="حذف"><Trash2 className="size-4 text-destructive" /></Button></AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader><AlertDialogTitle>حذف الحساب «{a.nameAr}»؟</AlertDialogTitle><AlertDialogDescription>لا يمكن التراجع.</AlertDialogDescription></AlertDialogHeader>
                            <AlertDialogFooter><AlertDialogCancel>إلغاء</AlertDialogCancel><AlertDialogAction onClick={() => remove(a)}>حذف</AlertDialogAction></AlertDialogFooter>
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
      <AccountDialog key={editing?.id ?? "new"} open={open} onOpenChange={setOpen} editing={editing} />
    </Card>
  );
}
