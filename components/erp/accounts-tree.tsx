"use client";

import { useActionState, useEffect, useMemo, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { Pencil, Trash2, Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { saveAccountAction, deleteAccountAction, type ActionState } from "@/app/actions/erp/accounts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Icon } from "@/components/icon";
import { cn } from "@/lib/utils";

export type Account = {
  id: string; code: string; nameAr: string; nameEn: string | null;
  type: string; normalBalance: string; parentId: string | null; isLeaf: boolean; isActive: boolean;
};

const TYPE_LABELS: Record<string, string> = {
  ASSET: "أصول", LIABILITY: "خصوم", EQUITY: "حقوق ملكية", REVENUE: "إيرادات", EXPENSE: "مصروفات",
};
const selectCls = "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm";

function SubmitBtn() {
  const { pending } = useFormStatus();
  return <Button type="submit" disabled={pending}>{pending && <Loader2 className="size-4 animate-spin" />}حفظ</Button>;
}

function AccountDialog({
  open, onOpenChange, editing, presetParent, accounts,
}: {
  open: boolean; onOpenChange: (o: boolean) => void;
  editing: Account | null; presetParent: string | null; accounts: Account[];
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(saveAccountAction, {});
  useEffect(() => {
    if (state.ok) { toast.success("تم الحفظ"); onOpenChange(false); }
    else if (state.error) toast.error(state.error);
  }, [state, onOpenChange]);

  // Parent options: any account except the one being edited (avoid self-parent).
  const parentOptions = accounts.filter((a) => a.id !== editing?.id);

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
              <Label htmlFor="a-parent">الحساب الأب</Label>
              <select id="a-parent" name="parentId" defaultValue={editing?.parentId ?? presetParent ?? ""} className={selectCls}>
                <option value="">— حساب رئيسي —</option>
                {parentOptions.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.nameAr}</option>)}
              </select>
            </div>
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
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isLeaf" defaultChecked={editing ? editing.isLeaf : true} />حساب تفصيلي (يقبل القيود)</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isActive" defaultChecked={editing ? editing.isActive : true} />نشط</label>
          </div>
          <DialogFooter><SubmitBtn /></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function AccountsTree({ accounts, canManage }: { accounts: Account[]; canManage: boolean }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  const [presetParent, setPresetParent] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const { roots, childrenOf } = useMemo(() => {
    const byParent = new Map<string, Account[]>();
    for (const a of accounts) {
      const key = a.parentId ?? "__root__";
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key)!.push(a);
    }
    for (const list of byParent.values()) list.sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
    return { roots: byParent.get("__root__") ?? [], childrenOf: byParent };
  }, [accounts]);

  // Expand all non-leaf nodes by default.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(accounts.filter((a) => !a.isLeaf).map((a) => a.id)));
  const toggle = (id: string) => setExpanded((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const openCreate = (parent: string | null) => { setEditing(null); setPresetParent(parent); setOpen(true); };
  const openEdit = (a: Account) => { setEditing(a); setPresetParent(null); setOpen(true); };
  const remove = (a: Account) => startTransition(async () => {
    const r = await deleteAccountAction(a.id);
    if (r.ok) toast.success("تم الحذف"); else toast.error(r.error ?? "تعذّر الحذف");
  });

  const renderNode = (a: Account, depth: number): React.ReactNode => {
    const kids = childrenOf.get(a.id) ?? [];
    const hasKids = kids.length > 0;
    const isOpen = expanded.has(a.id);
    return (
      <div key={a.id}>
        <div className="group flex items-center gap-2 border-b py-2 pe-2 text-sm hover:bg-muted/40"
          style={{ paddingInlineStart: depth * 22 + 8 }}>
          {hasKids ? (
            <button onClick={() => toggle(a.id)} className="grid size-5 place-items-center rounded hover:bg-accent" aria-label="طيّ">
              <Icon name={isOpen ? "ChevronDown" : "ChevronLeft"} className="size-4" />
            </button>
          ) : (
            <span className="inline-block size-5" />
          )}
          <Icon name={hasKids ? "Folder" : "FileText"} className={cn("size-4 shrink-0", hasKids ? "text-primary" : "text-muted-foreground")} />
          <span className="font-mono text-muted-foreground">{a.code}</span>
          <span className={cn(hasKids && "font-semibold")}>{a.nameAr}</span>
          {!a.isActive && <Badge variant="secondary">معطّل</Badge>}
          <Badge variant="secondary" className="ms-2">{TYPE_LABELS[a.type] ?? a.type}</Badge>
          <span className="text-xs text-muted-foreground">{a.normalBalance === "DEBIT" ? "مدين" : "دائن"}</span>
          {canManage && (
            <div className="ms-auto flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
              <Button variant="ghost" size="icon" className="size-7" onClick={() => openCreate(a.id)} aria-label="حساب فرعي"><Plus className="size-3.5" /></Button>
              <Button variant="ghost" size="icon" className="size-7" onClick={() => openEdit(a)} aria-label="تعديل"><Pencil className="size-3.5" /></Button>
              <AlertDialog>
                <AlertDialogTrigger asChild><Button variant="ghost" size="icon" className="size-7" disabled={pending} aria-label="حذف"><Trash2 className="size-3.5 text-destructive" /></Button></AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader><AlertDialogTitle>حذف الحساب «{a.nameAr}»؟</AlertDialogTitle><AlertDialogDescription>لا يمكن التراجع. تأكّد أنه بلا حسابات فرعية أو قيود.</AlertDialogDescription></AlertDialogHeader>
                  <AlertDialogFooter><AlertDialogCancel>إلغاء</AlertDialogCancel><AlertDialogAction onClick={() => remove(a)}>حذف</AlertDialogAction></AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          )}
        </div>
        {hasKids && isOpen && kids.map((k) => renderNode(k, depth + 1))}
      </div>
    );
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div><CardTitle>دليل الحسابات</CardTitle><CardDescription>شجرة الحسابات الهرمية للمؤسسة النشطة.</CardDescription></div>
        {canManage && <Button onClick={() => openCreate(null)}><Plus className="size-4" />حساب جديد</Button>}
      </CardHeader>
      <CardContent>
        {roots.length === 0 ? (
          <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">لا توجد حسابات بعد.</div>
        ) : (
          <div className="rounded-xl border">{roots.map((r) => renderNode(r, 0))}</div>
        )}
      </CardContent>
      <AccountDialog key={editing?.id ?? `new-${presetParent ?? "root"}`} open={open} onOpenChange={setOpen} editing={editing} presetParent={presetParent} accounts={accounts} />
    </Card>
  );
}
