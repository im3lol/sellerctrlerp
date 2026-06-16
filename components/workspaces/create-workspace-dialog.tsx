"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { createWorkspaceAction, type ActionState } from "@/app/actions/workspaces";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending && <Loader2 className="size-4 animate-spin" />}
      إنشاء
    </Button>
  );
}

export function CreateWorkspaceDialog({ clients }: { clients: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState<ActionState, FormData>(createWorkspaceAction, {});

  useEffect(() => {
    if (state.ok) {
      toast.success("تم إنشاء مساحة العمل");
      setOpen(false);
    } else if (state.error) {
      toast.error(state.error);
    }
  }, [state]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" />
          مساحة عمل جديدة
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form action={formAction} className="space-y-4">
          <DialogHeader>
            <DialogTitle>مساحة عمل جديدة</DialogTitle>
            <DialogDescription>أنشئ مساحة عمل مستقلة لعميل أو متجر.</DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="ws-name">اسم مساحة العمل</Label>
            <Input id="ws-name" name="name" placeholder="Amazon Store XYZ" required />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>المنصة</Label>
              <Select name="type" defaultValue="amazon">
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="amazon">أمازون</SelectItem>
                  <SelectItem value="noon">نون</SelectItem>
                  <SelectItem value="brand">براند</SelectItem>
                  <SelectItem value="other">أخرى</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>العميل (اختياري)</Label>
              <Select name="clientUserId" defaultValue="">
                <SelectTrigger>
                  <SelectValue placeholder="بدون عميل" />
                </SelectTrigger>
                <SelectContent>
                  {clients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="ws-desc">الوصف</Label>
            <Textarea id="ws-desc" name="description" rows={3} placeholder="وصف مختصر…" />
          </div>

          <DialogFooter>
            <Submit />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
