"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Settings, Pencil, Power, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  updateWorkspaceAction,
  setWorkspaceArchivedAction,
  deleteWorkspaceAction,
  type ActionState,
} from "@/app/actions/workspaces";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Ws = {
  id: string;
  name: string;
  type: string;
  description: string | null;
  clientUserId: string | null;
  isArchived: boolean;
};

export function WorkspaceSettings({ ws, clients }: { ws: Ws; clients: { id: string; name: string }[] }) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [state, formAction, pending] = useActionState<ActionState, FormData>(updateWorkspaceAction, {});
  const [busy, startBusy] = useTransition();

  useEffect(() => {
    if (state.ok) {
      toast.success("تم تحديث المساحة");
      setEditOpen(false);
      router.refresh();
    } else if (state.error) toast.error(state.error);
  }, [state, router]);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            <Settings className="size-4" />
            إدارة المساحة
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setEditOpen(true)}>
            <Pencil className="size-4" />
            تعديل البيانات
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() =>
              startBusy(async () => {
                const res = await setWorkspaceArchivedAction(ws.id, !ws.isArchived);
                if (res.ok) {
                  toast.success(ws.isArchived ? "تمت إعادة التفعيل" : "تم إيقاف المساحة");
                  router.refresh();
                } else toast.error(res.error ?? "تعذّر التنفيذ");
              })
            }
          >
            <Power className="size-4" />
            {ws.isArchived ? "إعادة تفعيل" : "إيقاف المساحة"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onClick={() => setDelOpen(true)}
          >
            <Trash2 className="size-4" />
            حذف نهائي
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Edit dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <form action={formAction} className="space-y-4">
            <DialogHeader>
              <DialogTitle>تعديل مساحة العمل</DialogTitle>
            </DialogHeader>
            <input type="hidden" name="workspaceId" value={ws.id} />
            <div className="space-y-2">
              <Label htmlFor="ws-name">الاسم</Label>
              <Input id="ws-name" name="name" defaultValue={ws.name} required />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>المنصة</Label>
                <Select name="type" defaultValue={ws.type}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="amazon">أمازون</SelectItem>
                    <SelectItem value="noon">نون</SelectItem>
                    <SelectItem value="brand">براند</SelectItem>
                    <SelectItem value="other">أخرى</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>العميل</Label>
                <Select name="clientUserId" defaultValue={ws.clientUserId ?? "none"}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">بدون</SelectItem>
                    {clients.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ws-desc">الوصف</Label>
              <Textarea id="ws-desc" name="description" defaultValue={ws.description ?? ""} rows={3} />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={pending}>
                {pending && <Loader2 className="size-4 animate-spin" />}
                حفظ
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={delOpen} onOpenChange={setDelOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف «{ws.name}» نهائياً؟</AlertDialogTitle>
            <AlertDialogDescription>
              سيُحذف كل ما يخص المساحة (المنتجات، المهام، الملفات، الأعضاء). لا يمكن التراجع.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                startBusy(async () => {
                  const res = await deleteWorkspaceAction(ws.id);
                  if (res.ok) {
                    toast.success("تم حذف المساحة");
                    router.push("/workspaces");
                  } else toast.error(res.error ?? "تعذّر الحذف");
                });
              }}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : "حذف"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
