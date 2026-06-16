"use client";

import { useState, useTransition } from "react";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { addMemberAction, removeMemberAction } from "@/app/actions/workspaces";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ROLE_LABELS_AR, type Role } from "@/lib/rbac";

type Member = { userId: string; name: string; avatarUrl: string | null; memberRole: string };
type Candidate = { id: string; name: string; role: string };

export function MembersPanel({
  workspaceId,
  members,
  candidates,
  canManage,
}: {
  workspaceId: string;
  members: Member[];
  candidates: Candidate[];
  canManage: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState<Role>("employee");
  const [pending, start] = useTransition();
  const initials = (n: string) => n.split(" ").slice(0, 2).map((p) => p[0]).join("");

  const add = () => {
    if (!userId) return;
    start(async () => {
      try {
        await addMemberAction(workspaceId, userId, role);
        toast.success("تمت الإضافة");
        setOpen(false);
        setUserId("");
      } catch {
        toast.error("تعذّرت الإضافة");
      }
    });
  };

  const remove = (uid: string) =>
    start(async () => {
      try {
        await removeMemberAction(workspaceId, uid);
        toast.success("تمت الإزالة");
      } catch {
        toast.error("تعذّرت الإزالة");
      }
    });

  return (
    <div className="space-y-3">
      {canManage && (
        <div className="flex justify-end">
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="size-4" />
                إضافة عضو
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>إضافة عضو إلى الفريق</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <Select value={userId} onValueChange={setUserId}>
                  <SelectTrigger>
                    <SelectValue placeholder="اختر موظفاً" />
                  </SelectTrigger>
                  <SelectContent>
                    {candidates.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name} · {ROLE_LABELS_AR[c.role as Role]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={role} onValueChange={(v) => setRole(v as Role)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="employee">موظف</SelectItem>
                    <SelectItem value="team_lead">قائد فريق</SelectItem>
                    <SelectItem value="ops_manager">مدير عمليات</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <DialogFooter>
                <Button onClick={add} disabled={pending || !userId}>
                  {pending && <Loader2 className="size-4 animate-spin" />}
                  إضافة
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      )}

      <div className="divide-y rounded-2xl border bg-card">
        {members.map((m) => (
          <div key={m.userId} className="flex items-center gap-3 p-3">
            <Avatar className="size-9">
              {m.avatarUrl && <AvatarImage src={m.avatarUrl} />}
              <AvatarFallback className="bg-primary/10 text-primary">{initials(m.name)}</AvatarFallback>
            </Avatar>
            <div className="flex-1">
              <p className="font-medium">{m.name}</p>
            </div>
            <Badge variant="secondary">{ROLE_LABELS_AR[m.memberRole as Role]}</Badge>
            {canManage && (
              <Button
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:text-destructive"
                onClick={() => remove(m.userId)}
                disabled={pending}
              >
                <Trash2 className="size-4" />
              </Button>
            )}
          </div>
        ))}
        {members.length === 0 && (
          <p className="p-6 text-center text-sm text-muted-foreground">لا يوجد أعضاء بعد</p>
        )}
      </div>
    </div>
  );
}
