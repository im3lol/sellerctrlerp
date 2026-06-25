"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { Plus, Pencil, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { saveCustomerAction, deleteCustomerAction, linkCustomerPortalUserAction, type ActionState } from "@/app/actions/erp/customers";
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

export type Customer = {
  id: string; code: string; nameAr: string; phone: string | null;
  email: string | null; balance: string | null; creditLimit: string | null; paymentTerms: number;
  portalUserId?: string | null;
};

const fmt = (v: string | null) => Number(v ?? 0).toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function SubmitBtn() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending && <Loader2 className="size-4 animate-spin" />}
      حفظ
    </Button>
  );
}

function CustomerDialog({
  open, onOpenChange, editing,
}: { open: boolean; onOpenChange: (o: boolean) => void; editing: Customer | null }) {
  const [state, formAction] = useActionState<ActionState, FormData>(saveCustomerAction, {});
  useEffect(() => {
    if (state.ok) { toast.success("تم الحفظ"); onOpenChange(false); }
    else if (state.error) toast.error(state.error);
  }, [state, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form action={formAction} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{editing ? "تعديل عميل" : "عميل جديد"}</DialogTitle>
            <DialogDescription>بيانات العميل للمؤسسة النشطة.</DialogDescription>
          </DialogHeader>
          {editing && <input type="hidden" name="id" value={editing.id} />}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="c-code">الكود</Label>
              <Input id="c-code" name="code" defaultValue={editing?.code} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="c-name">الاسم</Label>
              <Input id="c-name" name="nameAr" defaultValue={editing?.nameAr} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="c-phone">الهاتف</Label>
              <Input id="c-phone" name="phone" defaultValue={editing?.phone ?? ""} dir="ltr" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="c-email">البريد</Label>
              <Input id="c-email" name="email" type="email" defaultValue={editing?.email ?? ""} dir="ltr" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="c-credit">حد الائتمان</Label>
              <Input id="c-credit" name="creditLimit" type="number" step="0.01" defaultValue={editing?.creditLimit ?? "0"} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="c-terms">مدة السداد (يوم)</Label>
              <Input id="c-terms" name="paymentTerms" type="number" defaultValue={editing?.paymentTerms ?? 30} />
            </div>
          </div>
          <DialogFooter>
            <SubmitBtn />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PortalLinkDialog({
  open, onOpenChange, customer,
}: { open: boolean; onOpenChange: (o: boolean) => void; customer: Customer | null }) {
  const [email, setEmail] = useState(customer?.email ?? "");
  const [pending, start] = useTransition();

  if (!customer) return null;

  const handle = () => {
    start(async () => {
      const r = await linkCustomerPortalUserAction({ customerId: customer.id, email });
      if (r.ok) { toast.success(email ? "تم الربط بالبوابة" : "تم إلغاء الربط"); onOpenChange(false); }
      else toast.error(r.error ?? "تعذّر الربط");
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>ربط ببوابة العميل — {customer.nameAr}</DialogTitle>
          <DialogDescription>ادخل بريد المستخدم (دور: client) لربطه بهذا العميل. اتركه فارغاً لإلغاء الربط.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label>البريد الإلكتروني للمستخدم</Label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="user@example.com"
            dir="ltr"
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
          {customer.portalUserId && (
            <p className="text-xs text-success">مرتبط حالياً ببوابة عميل.</p>
          )}
        </div>
        <DialogFooter>
          <Button onClick={handle} disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            {email ? "ربط" : "إلغاء الربط"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CustomersManager({ customers, canManage }: { customers: Customer[]; canManage: boolean }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [portalOpen, setPortalOpen] = useState(false);
  const [portalCustomer, setPortalCustomer] = useState<Customer | null>(null);
  const [pending, startTransition] = useTransition();

  const openCreate = () => { setEditing(null); setOpen(true); };
  const openEdit = (c: Customer) => { setEditing(c); setOpen(true); };

  const remove = (c: Customer) =>
    startTransition(async () => {
      const r = await deleteCustomerAction(c.id);
      if (r.ok) toast.success("تم الحذف");
      else toast.error(r.error ?? "تعذّر الحذف");
    });

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div>
          <CardTitle>العملاء</CardTitle>
          <CardDescription>عملاء المؤسسة النشطة وأرصدتهم.</CardDescription>
        </div>
        {canManage && (
          <Button onClick={openCreate}>
            <Plus className="size-4" />
            عميل جديد
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {customers.length === 0 ? (
          <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">لا يوجد عملاء بعد.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-start">الكود</TableHead>
                <TableHead className="text-start">الاسم</TableHead>
                <TableHead className="text-start">الهاتف</TableHead>
                <TableHead className="text-start">الرصيد</TableHead>
                <TableHead className="text-start">حد الائتمان</TableHead>
                {canManage && <TableHead className="text-start">إجراءات</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {customers.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-mono">{c.code}</TableCell>
                  <TableCell>{c.nameAr}</TableCell>
                  <TableCell dir="ltr" className="text-start">{c.phone ?? "—"}</TableCell>
                  <TableCell>{fmt(c.balance)}</TableCell>
                  <TableCell>{fmt(c.creditLimit)}</TableCell>
                  {canManage && (
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" onClick={() => openEdit(c)} aria-label="تعديل">
                          <Pencil className="size-4" />
                        </Button>
                        <Button
                          variant="ghost" size="icon"
                          onClick={() => { setPortalCustomer(c); setPortalOpen(true); }}
                          aria-label="ربط ببوابة العميل"
                          title="ربط ببوابة العميل"
                        >
                          <span className={`text-base ${c.portalUserId ? "text-success" : "text-muted-foreground"}`}>🔗</span>
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon" disabled={pending} aria-label="حذف">
                              <Trash2 className="size-4 text-destructive" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>حذف العميل «{c.nameAr}»؟</AlertDialogTitle>
                              <AlertDialogDescription>لا يمكن التراجع عن هذا الإجراء.</AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>إلغاء</AlertDialogCancel>
                              <AlertDialogAction onClick={() => remove(c)}>حذف</AlertDialogAction>
                            </AlertDialogFooter>
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
      {/* key forces fresh form state per create/edit target */}
      <CustomerDialog key={editing?.id ?? "new"} open={open} onOpenChange={setOpen} editing={editing} />
      <PortalLinkDialog key={`portal-${portalCustomer?.id}`} open={portalOpen} onOpenChange={setPortalOpen} customer={portalCustomer} />
    </Card>
  );
}
