"use client";

import { useActionState, useEffect, useMemo, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { Pencil, Trash2, Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { saveCostCenterAction, deleteCostCenterAction, type ActionState } from "@/app/actions/erp/cost-centers";
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

export type CostCenter = {
  id: string; code: string; nameAr: string; nameEn: string | null; parentId: string | null; isActive: boolean;
};

const selectCls = "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm";

function SubmitBtn() {
  const { pending } = useFormStatus();
  return <Button type="submit" disabled={pending}>{pending && <Loader2 className="size-4 animate-spin" />}حفظ</Button>;
}

function CenterDialog({
  open, onOpenChange, editing, presetParent, centers,
}: {
  open: boolean; onOpenChange: (o: boolean) => void;
  editing: CostCenter | null; presetParent: string | null; centers: CostCenter[];
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(saveCostCenterAction, {});
  useEffect(() => {
    if (state.ok) { toast.success("تم الحفظ"); onOpenChange(false); }
    else if (state.error) toast.error(state.error);
  }, [state, onOpenChange]);

  const parentOptions = centers.filter((c) => c.id !== editing?.id);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form action={formAction} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{editing ? "تعديل مركز تكلفة" : "مركز تكلفة جديد"}</DialogTitle>
            <DialogDescription>مركز تكلفة ضمن هيكل المؤسسة النشطة.</DialogDescription>
          </DialogHeader>
          {editing && <input type="hidden" name="id" value={editing.id} />}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2"><Label htmlFor="c-code">الكود</Label><Input id="c-code" name="code" defaultValue={editing?.code} required /></div>
            <div className="space-y-2"><Label htmlFor="c-name">الاسم</Label><Input id="c-name" name="nameAr" defaultValue={editing?.nameAr} required /></div>
            <div className="space-y-2"><Label htmlFor="c-name-en">الاسم (إنجليزي)</Label><Input id="c-name-en" name="nameEn" defaultValue={editing?.nameEn ?? ""} /></div>
            <div className="space-y-2">
              <Label htmlFor="c-parent">المركز الأب</Label>
              <select id="c-parent" name="parentId" defaultValue={editing?.parentId ?? presetParent ?? ""} className={selectCls}>
                <option value="">— مركز رئيسي —</option>
                {parentOptions.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.nameAr}</option>)}
              </select>
            </div>
          </div>
          <div className="flex gap-6">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isActive" defaultChecked={editing ? editing.isActive : true} />نشط</label>
          </div>
          <DialogFooter><SubmitBtn /></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function CostCentersTree({ centers, canManage }: { centers: CostCenter[]; canManage: boolean }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<CostCenter | null>(null);
  const [presetParent, setPresetParent] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const { roots, childrenOf } = useMemo(() => {
    const byParent = new Map<string, CostCenter[]>();
    for (const c of centers) {
      const key = c.parentId ?? "__root__";
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key)!.push(c);
    }
    for (const list of byParent.values()) list.sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
    return { roots: byParent.get("__root__") ?? [], childrenOf: byParent };
  }, [centers]);

  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(centers.map((c) => c.id)));
  const toggle = (id: string) => setExpanded((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const openCreate = (parent: string | null) => { setEditing(null); setPresetParent(parent); setOpen(true); };
  const openEdit = (c: CostCenter) => { setEditing(c); setPresetParent(null); setOpen(true); };
  const remove = (c: CostCenter) => startTransition(async () => {
    const r = await deleteCostCenterAction(c.id);
    if (r.ok) toast.success("تم الحذف"); else toast.error(r.error ?? "تعذّر الحذف");
  });

  const renderNode = (c: CostCenter, depth: number): React.ReactNode => {
    const kids = childrenOf.get(c.id) ?? [];
    const hasKids = kids.length > 0;
    const isOpen = expanded.has(c.id);
    return (
      <div key={c.id}>
        <div className="group flex items-center gap-2 border-b py-2 pe-2 text-sm hover:bg-muted/40"
          style={{ paddingInlineStart: depth * 22 + 8 }}>
          {hasKids ? (
            <button onClick={() => toggle(c.id)} className="grid size-5 place-items-center rounded hover:bg-accent" aria-label="طيّ">
              <Icon name={isOpen ? "ChevronDown" : "ChevronLeft"} className="size-4" />
            </button>
          ) : (
            <span className="inline-block size-5" />
          )}
          <Icon name={hasKids ? "FolderTree" : "Target"} className={cn("size-4 shrink-0", hasKids ? "text-primary" : "text-muted-foreground")} />
          <span className="font-mono text-muted-foreground">{c.code}</span>
          <span className={cn(hasKids && "font-semibold")}>{c.nameAr}</span>
          {!c.isActive && <Badge variant="secondary">معطّل</Badge>}
          {canManage && (
            <div className="ms-auto flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
              <Button variant="ghost" size="icon" className="size-7" onClick={() => openCreate(c.id)} aria-label="مركز فرعي"><Plus className="size-3.5" /></Button>
              <Button variant="ghost" size="icon" className="size-7" onClick={() => openEdit(c)} aria-label="تعديل"><Pencil className="size-3.5" /></Button>
              <AlertDialog>
                <AlertDialogTrigger asChild><Button variant="ghost" size="icon" className="size-7" disabled={pending} aria-label="حذف"><Trash2 className="size-3.5 text-destructive" /></Button></AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader><AlertDialogTitle>حذف المركز «{c.nameAr}»؟</AlertDialogTitle><AlertDialogDescription>لا يمكن التراجع. تأكّد أنه بلا مراكز فرعية أو قيود.</AlertDialogDescription></AlertDialogHeader>
                  <AlertDialogFooter><AlertDialogCancel>إلغاء</AlertDialogCancel><AlertDialogAction onClick={() => remove(c)}>حذف</AlertDialogAction></AlertDialogFooter>
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
        <div><CardTitle>مراكز التكلفة</CardTitle><CardDescription>هيكل مراكز التكلفة الهرمي للمؤسسة النشطة.</CardDescription></div>
        {canManage && <Button onClick={() => openCreate(null)}><Plus className="size-4" />مركز جديد</Button>}
      </CardHeader>
      <CardContent>
        {roots.length === 0 ? (
          <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">لا توجد مراكز تكلفة بعد.</div>
        ) : (
          <div className="rounded-xl border">{roots.map((r) => renderNode(r, 0))}</div>
        )}
      </CardContent>
      <CenterDialog key={editing?.id ?? `new-${presetParent ?? "root"}`} open={open} onOpenChange={setOpen} editing={editing} presetParent={presetParent} centers={centers} />
    </Card>
  );
}
