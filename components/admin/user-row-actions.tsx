"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { updateUserAction, deleteUserAction, type ActionState } from "@/app/actions/users";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type U = { id: string; name: string; email: string; role: string; title?: string | null };

export function UserRowActions({ user, clientOnly = false }: { user: U; clientOnly?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<ActionState, FormData>(updateUserAction, {});
  const [deleting, startDelete] = useTransition();

  useEffect(() => {
    if (state.ok) {
      toast.success("تم تحديث البيانات");
      setOpen(false);
      router.refresh();
    } else if (state.error) toast.error(state.error);
  }, [state, router]);

  return (
    <div className="flex items-center justify-end gap-1">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="ghost" size="icon" title="تعديل">
            <Pencil className="size-4" />
          </Button>
        </DialogTrigger>
        <DialogContent>
          <form action={formAction} className="space-y-4">
            <DialogHeader>
              <DialogTitle>تعديل {clientOnly ? "العميل" : "الموظف"}</DialogTitle>
            </DialogHeader>
            <input type="hidden" name="userId" value={user.id} />

            <div className="space-y-2">
              <Label htmlFor={`e-name-${user.id}`}>الاسم</Label>
              <Input id={`e-name-${user.id}`} name="name" defaultValue={user.name} required />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor={`e-email-${user.id}`}>البريد الإلكتروني</Label>
                <Input id={`e-email-${user.id}`} name="email" type="email" dir="ltr" defaultValue={user.email} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`e-pass-${user.id}`}>كلمة مرور جديدة</Label>
                <Input id={`e-pass-${user.id}`} name="password" type="text" dir="ltr" placeholder="اتركه فارغاً" minLength={6} />
              </div>
            </div>

            {clientOnly ? (
              <input type="hidden" name="role" value="client" />
            ) : (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>الدور</Label>
                  <Select name="role" defaultValue={user.role}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="employee">موظف</SelectItem>
                      <SelectItem value="team_lead">قائد فريق</SelectItem>
                      <SelectItem value="ops_manager">مدير عمليات</SelectItem>
                      <SelectItem value="system_admin">مدير النظام</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`e-title-${user.id}`}>المسمى الوظيفي</Label>
                  <Input id={`e-title-${user.id}`} name="title" defaultValue={user.title ?? ""} placeholder="اختياري" />
                </div>
              </div>
            )}

            <DialogFooter>
              <Button type="submit" disabled={pending}>
                {pending && <Loader2 className="size-4 animate-spin" />}
                حفظ
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive" title="حذف">
            <Trash2 className="size-4" />
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف {user.name}؟</AlertDialogTitle>
            <AlertDialogDescription>
              سيُحذف الحساب نهائياً. المنتجات والمهام المُسندة إليه ستصبح غير معيّنة. لا يمكن التراجع.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={(e) => {
                e.preventDefault();
                startDelete(async () => {
                  const res = await deleteUserAction(user.id);
                  if (res.ok) {
                    toast.success("تم الحذف");
                    router.refresh();
                  } else toast.error(res.error ?? "تعذّر الحذف");
                });
              }}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {deleting ? <Loader2 className="size-4 animate-spin" /> : "حذف"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
