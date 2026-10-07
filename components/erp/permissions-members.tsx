"use client";

import { useState, useTransition } from "react";
import { fill } from "@/lib/i18n";
import { useT } from "@/lib/i18n/client";
import { toast } from "@/lib/i18n/toast";
import { Plus, Trash2, Loader2, SlidersHorizontal } from "lucide-react";
import { addUserToOrgAction, removeUserFromOrgAction, setMemberOverridesAction, inviteMemberAction } from "@/app/actions/erp/members";
import { validatePassword, PASSWORD_RULE_AR } from "@/lib/auth/password-policy";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { selectCls } from "@/lib/utils";

export type Member = { userId: string; name: string; email: string; role: string; isSystemAdmin: boolean; grant: string[]; revoke: string[] };
export type Assignable = { id: string; name: string; email: string };
type Catalog = { key: string; label: string; perms: { key: string; action: string }[] }[];

type OverrideState = "inherit" | "grant" | "revoke";

function OverridesDialog({
  member, rolePerms, catalog, roleLabels, onClose,
}: {
  member: Member; rolePerms: Record<string, string[]>; catalog: Catalog; roleLabels: Record<string, string>; onClose: () => void;
}) {
  const t = useT();
  const [pending, start] = useTransition();
  const base = new Set(rolePerms[member.role] ?? []);
  const [state, setState] = useState<Record<string, OverrideState>>(() => {
    const s: Record<string, OverrideState> = {};
    for (const p of member.grant) s[p] = "grant";
    for (const p of member.revoke) s[p] = "revoke";
    return s;
  });

  const setOne = (perm: string, v: OverrideState) => setState((s) => ({ ...s, [perm]: v }));
  const effective = (perm: string) => {
    const st = state[perm] ?? "inherit";
    if (st === "grant") return true;
    if (st === "revoke") return false;
    return base.has(perm);
  };
  const overrideCount = Object.values(state).filter((v) => v !== "inherit").length;

  const save = () => start(async () => {
    const grant = Object.keys(state).filter((p) => state[p] === "grant");
    const revoke = Object.keys(state).filter((p) => state[p] === "revoke");
    const r = await setMemberOverridesAction(member.userId, grant, revoke);
    if (r.ok) { toast.success("تم حفظ الصلاحيات المخصّصة"); onClose(); } else toast.error(r.error ?? t("تعذّر الحفظ"));
  });

  return (
    <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{t("صلاحيات مخصّصة —")} {t(member.name)}</DialogTitle>
        <DialogDescription>
          {t("الدور:")} <b>{t(roleLabels[member.role] ?? member.role)}</b>{t(". «موروث» يتبع الدور؛ «سماح» يمنح الصلاحية فوق الدور؛ «منع» يسحبها.")} {overrideCount > 0 && <span>({overrideCount} {t("تخصيص)")}</span>}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        {catalog.map((g) => (
          <div key={g.key} className="rounded-xl border">
            <div className="border-b bg-muted/30 px-3 py-2 text-sm font-bold text-primary">{t(g.label)}</div>
            <div className="divide-y">
              {g.perms.map((p) => {
                const st = state[p.key] ?? "inherit";
                const eff = effective(p.key);
                const roleHas = base.has(p.key);
                return (
                  <div key={p.key} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                    <div className="flex items-center gap-2">
                      <span>{p.action}</span>
                      <span className="text-xs text-muted-foreground">{t("(الدور:")} {roleHas ? t("مسموح") : t("لا")})</span>
                      <Badge variant={eff ? "default" : "outline"} className="text-[10px]">{eff ? t("الفعلي: مسموح") : t("الفعلي: ممنوع")}</Badge>
                    </div>
                    <select value={st} onChange={(e) => setOne(p.key, e.target.value as OverrideState)} className={`${selectCls} h-8 text-xs`}>
                      <option value="inherit">{t("موروث من الدور")}</option>
                      <option value="grant">{t("سماح دائم")}</option>
                      <option value="revoke">{t("منع دائم")}</option>
                    </select>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>{t("إلغاء")}</Button>
        <Button onClick={save} disabled={pending}>{pending && <Loader2 className="size-4 animate-spin" />}{t("حفظ")}</Button>
      </DialogFooter>
    </DialogContent>
  );
}

export function PermissionsMembers({
  members, nonMembers, roleOptions, roleLabels, canManage, rolePerms, catalog,
}: {
  members: Member[];
  nonMembers: Assignable[];
  roleOptions: { value: string; label: string }[];
  roleLabels: Record<string, string>;
  canManage: boolean;
  rolePerms: Record<string, string[]>;
  catalog: Catalog;
}) {
  const t = useT();
  const [pending, start] = useTransition();
  const [addUser, setAddUser] = useState("");
  const [addRole, setAddRole] = useState("viewer");
  const [customizing, setCustomizing] = useState<Member | null>(null);
  const [inv, setInv] = useState({ name: "", email: "", role: "viewer", password: "" });

  const invite = () => {
    if (inv.name.trim().length < 2) { toast.error("أدخل اسم العضو"); return; }
    if (!inv.email.trim()) { toast.error("أدخل البريد الإلكتروني"); return; }
    { const e = validatePassword(inv.password); if (e) { toast.error(e); return; } }
    start(async () => {
      const r = await inviteMemberAction(inv);
      if (r.ok) { toast.success("تمت إضافة العضو"); setInv({ name: "", email: "", role: "viewer", password: "" }); }
      else toast.error(r.error ?? t("تعذّر التنفيذ"));
    });
  };

  const setRole = (userId: string, role: string) => start(async () => {
    const r = await addUserToOrgAction(userId, role);
    if (r.ok) toast.success("تم تحديث الدور"); else toast.error(r.error ?? t("تعذّر التحديث"));
  });
  const remove = (userId: string) => start(async () => {
    const r = await removeUserFromOrgAction(userId);
    if (r.ok) toast.success("تمت الإزالة"); else toast.error(r.error ?? t("تعذّر التنفيذ"));
  });
  const add = () => {
    if (!addUser) { toast.error("اختر مستخدماً"); return; }
    start(async () => {
      const r = await addUserToOrgAction(addUser, addRole);
      if (r.ok) { toast.success("تمت الإضافة"); setAddUser(""); } else toast.error(r.error ?? t("تعذّر التنفيذ"));
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("أعضاء المؤسسة وأدوارهم")}</CardTitle>
        <CardDescription>{t("يحدّد دور كل مستخدم ما يمكنه فعله. استخدم «تخصيص» لمنح أو منع صلاحيات فردية فوق الدور.")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {canManage && (
          <div className="space-y-3 rounded-xl border p-3">
            <div className="text-sm font-medium">{t("دعوة عضو جديد للفريق")}</div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <input className={`${selectCls} w-full`} placeholder={t("الاسم")} value={inv.name} onChange={(e) => setInv({ ...inv, name: e.target.value })} />
              <input className={`${selectCls} w-full`} placeholder={t("البريد الإلكتروني")} type="email" dir="ltr" value={inv.email} onChange={(e) => setInv({ ...inv, email: e.target.value })} />
              <select className={`${selectCls} w-full`} value={inv.role} onChange={(e) => setInv({ ...inv, role: e.target.value })}>
                {roleOptions.map((r) => <option key={r.value} value={r.value}>{t(r.label)}</option>)}
              </select>
              <input className={`${selectCls} w-full`} placeholder={fill(t("كلمة مرور مبدئية — {0}"), [t(PASSWORD_RULE_AR)])} type="text" dir="ltr" value={inv.password} onChange={(e) => setInv({ ...inv, password: e.target.value })} />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={invite} disabled={pending}>{pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}{t("إضافة العضو")}</Button>
              <span className="text-xs text-muted-foreground">{t("يدخل العضو بالبريد وكلمة المرور المبدئية، ويشوف الوحدات حسب دوره فقط.")}</span>
            </div>
          </div>
        )}

        {canManage && nonMembers.length > 0 && (
          <div className="flex flex-wrap items-end gap-3 rounded-xl border p-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">{t("إضافة مستخدم للمؤسسة")}</label>
              <select value={addUser} onChange={(e) => setAddUser(e.target.value)} className={`${selectCls} min-w-56`}>
                <option value="">{t("اختر مستخدماً…")}</option>
                {nonMembers.map((u) => <option key={u.id} value={u.id}>{t(u.name)} — {u.email}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">{t("الدور")}</label>
              <select value={addRole} onChange={(e) => setAddRole(e.target.value)} className={selectCls}>
                {roleOptions.map((r) => <option key={r.value} value={r.value}>{t(r.label)}</option>)}
              </select>
            </div>
            <Button onClick={add} disabled={pending}>{pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}{t("إضافة")}</Button>
          </div>
        )}

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-start">{t("المستخدم")}</TableHead>
              <TableHead className="text-start">{t("الدور")}</TableHead>
              <TableHead className="text-start">{t("تخصيصات")}</TableHead>
              {canManage && <TableHead className="text-start">{t("إجراءات")}</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((m) => {
              const overrides = m.grant.length + m.revoke.length;
              return (
                <TableRow key={m.userId}>
                  <TableCell>
                    <div className="font-medium">{t(m.name)}</div>
                    <div className="text-xs text-muted-foreground" dir="ltr">{m.email}</div>
                  </TableCell>
                  <TableCell>
                    {m.isSystemAdmin ? (
                      <Badge>{t("مدير النظام — كل الصلاحيات")}</Badge>
                    ) : canManage ? (
                      <select value={m.role} onChange={(e) => setRole(m.userId, e.target.value)} disabled={pending} className={selectCls}>
                        {roleOptions.map((r) => <option key={r.value} value={r.value}>{t(r.label)}</option>)}
                      </select>
                    ) : (
                      <Badge variant="outline">{roleLabels[m.role] ?? m.role}</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {m.isSystemAdmin ? <span className="text-xs text-muted-foreground">—</span> : overrides > 0 ? (
                      <div className="flex gap-1">
                        {m.grant.length > 0 && <Badge variant="default" className="text-[10px]">+{m.grant.length} {t("سماح")}</Badge>}
                        {m.revoke.length > 0 && <Badge variant="destructive" className="text-[10px]">−{m.revoke.length} {t("منع")}</Badge>}
                      </div>
                    ) : <span className="text-xs text-muted-foreground">{t("لا شيء")}</span>}
                  </TableCell>
                  {canManage && (
                    <TableCell>
                      <div className="flex gap-1">
                        {!m.isSystemAdmin && (
                          <>
                            <Button variant="ghost" size="sm" disabled={pending} onClick={() => setCustomizing(m)}>
                              <SlidersHorizontal className="me-1 size-4" />{t("تخصيص")}
                            </Button>
                            <Button variant="ghost" size="icon" disabled={pending} onClick={() => remove(m.userId)} aria-label={t("إزالة من المؤسسة")}>
                              <Trash2 className="size-4 text-destructive" />
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>

      <Dialog open={!!customizing} onOpenChange={(o) => !o && setCustomizing(null)}>
        {customizing && <OverridesDialog key={customizing.userId} member={customizing} rolePerms={rolePerms} catalog={catalog} roleLabels={roleLabels} onClose={() => setCustomizing(null)} />}
      </Dialog>
    </Card>
  );
}
