"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { addUserToOrgAction, removeUserFromOrgAction } from "@/app/actions/erp/members";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export type Member = { userId: string; name: string; email: string; role: string; isSystemAdmin: boolean };
export type Assignable = { id: string; name: string; email: string };

const selectCls = "flex h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm";

export function PermissionsMembers({
  members, nonMembers, roleOptions, roleLabels, canManage,
}: {
  members: Member[];
  nonMembers: Assignable[];
  roleOptions: { value: string; label: string }[];
  roleLabels: Record<string, string>;
  canManage: boolean;
}) {
  const [pending, start] = useTransition();
  const [addUser, setAddUser] = useState("");
  const [addRole, setAddRole] = useState("viewer");

  const setRole = (userId: string, role: string) => start(async () => {
    const r = await addUserToOrgAction(userId, role);
    if (r.ok) toast.success("تم تحديث الدور"); else toast.error(r.error ?? "تعذّر التحديث");
  });
  const remove = (userId: string) => start(async () => {
    const r = await removeUserFromOrgAction(userId);
    if (r.ok) toast.success("تمت الإزالة"); else toast.error(r.error ?? "تعذّر التنفيذ");
  });
  const add = () => {
    if (!addUser) { toast.error("اختر مستخدماً"); return; }
    start(async () => {
      const r = await addUserToOrgAction(addUser, addRole);
      if (r.ok) { toast.success("تمت الإضافة"); setAddUser(""); } else toast.error(r.error ?? "تعذّر التنفيذ");
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>أعضاء المؤسسة وأدوارهم</CardTitle>
        <CardDescription>يحدّد دور كل مستخدم ما يمكنه فعله. راجع مصفوفة الصلاحيات أدناه لمعرفة تفاصيل كل دور.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {canManage && nonMembers.length > 0 && (
          <div className="flex flex-wrap items-end gap-3 rounded-xl border p-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">إضافة مستخدم للمؤسسة</label>
              <select value={addUser} onChange={(e) => setAddUser(e.target.value)} className={`${selectCls} min-w-56`}>
                <option value="">اختر مستخدماً…</option>
                {nonMembers.map((u) => <option key={u.id} value={u.id}>{u.name} — {u.email}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">الدور</label>
              <select value={addRole} onChange={(e) => setAddRole(e.target.value)} className={selectCls}>
                {roleOptions.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
            <Button onClick={add} disabled={pending}>{pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}إضافة</Button>
          </div>
        )}

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-start">المستخدم</TableHead>
              <TableHead className="text-start">الدور (الصلاحيات)</TableHead>
              {canManage && <TableHead className="text-start">إجراءات</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((m) => (
              <TableRow key={m.userId}>
                <TableCell>
                  <div className="font-medium">{m.name}</div>
                  <div className="text-xs text-muted-foreground" dir="ltr">{m.email}</div>
                </TableCell>
                <TableCell>
                  {m.isSystemAdmin ? (
                    <Badge>مدير النظام — كل الصلاحيات</Badge>
                  ) : canManage ? (
                    <select value={m.role} onChange={(e) => setRole(m.userId, e.target.value)} disabled={pending} className={selectCls}>
                      {roleOptions.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                    </select>
                  ) : (
                    <Badge variant="outline">{roleLabels[m.role] ?? m.role}</Badge>
                  )}
                </TableCell>
                {canManage && (
                  <TableCell>
                    {!m.isSystemAdmin && (
                      <Button variant="ghost" size="icon" disabled={pending} onClick={() => remove(m.userId)} aria-label="إزالة من المؤسسة">
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
