"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { createUserAction, type ActionState } from "@/app/actions/users";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending && <Loader2 className="size-4 animate-spin" />}
      {label}
    </Button>
  );
}

/**
 * Create a staff member or a client. When `clientOnly`, the role is fixed to
 * "client" and the role selector is hidden.
 */
export function CreateUserDialog({
  clientOnly = false,
  triggerLabel,
}: {
  clientOnly?: boolean;
  triggerLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState<ActionState, FormData>(createUserAction, {});

  useEffect(() => {
    if (state.ok) {
      toast.success("تم إنشاء الحساب");
      setOpen(false);
    } else if (state.error) toast.error(state.error);
  }, [state]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form action={formAction} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{triggerLabel}</DialogTitle>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="u-name">الاسم</Label>
            <Input id="u-name" name="name" required />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="u-email">البريد الإلكتروني</Label>
              <Input id="u-email" name="email" type="email" dir="ltr" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="u-pass">كلمة المرور</Label>
              <Input id="u-pass" name="password" type="text" dir="ltr" required minLength={6} />
            </div>
          </div>

          {clientOnly ? (
            <input type="hidden" name="role" value="client" />
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>الدور</Label>
                <Select name="role" defaultValue="employee">
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
                <Label htmlFor="u-title">المسمى الوظيفي</Label>
                <Input id="u-title" name="title" placeholder="اختياري" />
              </div>
            </div>
          )}

          <DialogFooter>
            <Submit label="إنشاء" />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
