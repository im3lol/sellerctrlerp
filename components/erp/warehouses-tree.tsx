"use client";

import { useActionState, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { Pencil, Trash2, Plus, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { saveWarehouseAction, deleteWarehouseAction, importWarehousesCsvAction } from "@/app/actions/erp/warehouses";
import { exportWarehousesCsvAction } from "@/app/actions/erp/exports";
import { ExportCsvButton } from "@/components/erp/export-csv-button";
import { WAREHOUSE_TYPES, WAREHOUSE_TYPE_LABEL } from "@/lib/erp/warehouse-types";
import type { ActionState } from "@/lib/erp/action-auth";
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
import { cn, selectCls } from "@/lib/utils";

export type Warehouse = {
  id: string; code: string; nameAr: string; type: string; parentId: string | null;
  location: string | null; manager: string | null; isActive: boolean;
};

function SubmitBtn() {
  const { pending } = useFormStatus();
  return <Button type="submit" disabled={pending}>{pending && <Loader2 className="size-4 animate-spin" />}حفظ</Button>;
}

function WarehouseDialog({
  open, onOpenChange, editing, presetParent, all,
}: {
  open: boolean; onOpenChange: (o: boolean) => void;
  editing: Warehouse | null; presetParent: string | null; all: Warehouse[];
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(saveWarehouseAction, {});
  useEffect(() => {
    if (state.ok) { toast.success("تم الحفظ"); onOpenChange(false); }
    else if (state.error) toast.error(state.error);
  }, [state, onOpenChange]);

  const parentOptions = all.filter((w) => w.id !== editing?.id);
  // A sub-level defaults to ZONE; a root defaults to WAREHOUSE.
  const defaultType = editing?.type ?? (presetParent ? "ZONE" : "WAREHOUSE");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form action={formAction} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{editing ? "تعديل مخزن" : "مخزن جديد"}</DialogTitle>
            <DialogDescription>مخزن رئيسي أو موقع فرعي (منطقة/رف/صندوق) ضمن المؤسسة النشطة.</DialogDescription>
          </DialogHeader>
          {editing && <input type="hidden" name="id" value={editing.id} />}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2"><Label htmlFor="w-code">الكود</Label><Input id="w-code" name="code" defaultValue={editing?.code} required /></div>
            <div className="space-y-2"><Label htmlFor="w-name">الاسم</Label><Input id="w-name" name="nameAr" defaultValue={editing?.nameAr} required /></div>
            <div className="space-y-2">
              <Label htmlFor="w-type">النوع / المستوى</Label>
              <select id="w-type" name="type" defaultValue={defaultType} className={selectCls}>
                {WAREHOUSE_TYPES.map((t) => <option key={t} value={t}>{WAREHOUSE_TYPE_LABEL[t]}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="w-parent">المخزن الأب</Label>
              <select id="w-parent" name="parentId" defaultValue={editing?.parentId ?? presetParent ?? ""} className={selectCls}>
                <option value="">— مخزن رئيسي —</option>
                {parentOptions.map((w) => <option key={w.id} value={w.id}>{w.code} — {w.nameAr}</option>)}
              </select>
            </div>
            <div className="space-y-2"><Label htmlFor="w-loc">الموقع</Label><Input id="w-loc" name="location" defaultValue={editing?.location ?? ""} /></div>
            <div className="space-y-2"><Label htmlFor="w-mgr">المسؤول</Label><Input id="w-mgr" name="manager" defaultValue={editing?.manager ?? ""} /></div>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isActive" defaultChecked={editing ? editing.isActive : true} />نشط</label>
          <DialogFooter><SubmitBtn /></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function WarehousesTree({ warehouses, canManage }: { warehouses: Warehouse[]; canManage: boolean }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Warehouse | null>(null);
  const [presetParent, setPresetParent] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [importing, startImport] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  const { roots, childrenOf } = useMemo(() => {
    const byParent = new Map<string, Warehouse[]>();
    for (const w of warehouses) {
      const key = w.parentId ?? "__root__";
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key)!.push(w);
    }
    for (const list of byParent.values()) list.sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
    return { roots: byParent.get("__root__") ?? [], childrenOf: byParent };
  }, [warehouses]);

  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(warehouses.map((w) => w.id)));
  const toggle = (id: string) => setExpanded((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const openCreate = (parent: string | null) => { setEditing(null); setPresetParent(parent); setOpen(true); };
  const openEdit = (w: Warehouse) => { setEditing(w); setPresetParent(null); setOpen(true); };
  const remove = (w: Warehouse) => startTransition(async () => {
    const r = await deleteWarehouseAction(w.id);
    if (r.ok) toast.success("تم الحذف"); else toast.error(r.error ?? "تعذّر الحذف");
  });

  const onImportFile = (file: File) => startImport(async () => {
    const text = await file.text();
    const r = await importWarehousesCsvAction(text);
    if (fileRef.current) fileRef.current.value = "";
    if (!r.ok) { toast.error(r.error); return; }
    toast.success(`تم الاستيراد: ${r.inserted ?? 0} جديد، ${r.updated ?? 0} محدّث`);
    if (r.errors?.length) toast.warning(`${r.errors.length} تحذير: ${r.errors.slice(0, 3).join("؛ ")}${r.errors.length > 3 ? " …" : ""}`, { duration: 12000 });
  });

  const renderNode = (w: Warehouse, depth: number): React.ReactNode => {
    const kids = childrenOf.get(w.id) ?? [];
    const hasKids = kids.length > 0;
    const isOpen = expanded.has(w.id);
    return (
      <div key={w.id}>
        <div className="group flex items-center gap-2 border-b py-2 pe-2 text-sm hover:bg-muted/40" style={{ paddingInlineStart: depth * 22 + 8 }}>
          {hasKids ? (
            <button onClick={() => toggle(w.id)} className="grid size-5 place-items-center rounded hover:bg-accent" aria-label="طيّ">
              <Icon name={isOpen ? "ChevronDown" : "ChevronLeft"} className="size-4" />
            </button>
          ) : <span className="inline-block size-5" />}
          <Icon name={w.type === "WAREHOUSE" ? "Warehouse" : hasKids ? "FolderTree" : "Box"} className={cn("size-4 shrink-0", w.type === "WAREHOUSE" ? "text-primary" : "text-muted-foreground")} />
          <span className="font-mono text-muted-foreground">{w.code}</span>
          <span className={cn(w.type === "WAREHOUSE" && "font-semibold")}>{w.nameAr}</span>
          <Badge variant="outline">{WAREHOUSE_TYPE_LABEL[w.type] ?? w.type}</Badge>
          {w.location && <span className="text-xs text-muted-foreground">{w.location}</span>}
          {!w.isActive && <Badge variant="secondary">معطّل</Badge>}
          {canManage && (
            <div className="ms-auto flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
              <Button variant="ghost" size="icon" className="size-7" onClick={() => openCreate(w.id)} aria-label="موقع فرعي"><Plus className="size-3.5" /></Button>
              <Button variant="ghost" size="icon" className="size-7" onClick={() => openEdit(w)} aria-label="تعديل"><Pencil className="size-3.5" /></Button>
              <AlertDialog>
                <AlertDialogTrigger asChild><Button variant="ghost" size="icon" className="size-7" disabled={pending} aria-label="حذف"><Trash2 className="size-3.5 text-destructive" /></Button></AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader><AlertDialogTitle>حذف «{w.nameAr}»؟</AlertDialogTitle><AlertDialogDescription>لا يمكن التراجع. تأكّد أنه بلا مواقع فرعية أو حركات مخزون.</AlertDialogDescription></AlertDialogHeader>
                  <AlertDialogFooter><AlertDialogCancel>إلغاء</AlertDialogCancel><AlertDialogAction onClick={() => remove(w)}>حذف</AlertDialogAction></AlertDialogFooter>
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
      <CardHeader className="flex-row items-center justify-between gap-3">
        <div><CardTitle>المخازن</CardTitle><CardDescription>هيكل هرمي: مخزن رئيسي ← منطقة ← رف ← صندوق. تصدير/استيراد CSV للإدارة بالجملة.</CardDescription></div>
        <div className="flex items-center gap-2">
          <ExportCsvButton action={exportWarehousesCsvAction} />
          {canManage && (
            <>
              <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onImportFile(f); }} />
              <Button variant="outline" size="sm" disabled={importing} onClick={() => fileRef.current?.click()}>
                {importing ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}استيراد CSV
              </Button>
              <Button onClick={() => openCreate(null)}><Plus className="size-4" />مخزن جديد</Button>
            </>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {roots.length === 0 ? (
          <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">لا توجد مخازن بعد. أنشئ أول مخزن رئيسي.</div>
        ) : (
          <div className="rounded-xl border">{roots.map((r) => renderNode(r, 0))}</div>
        )}
      </CardContent>
      <WarehouseDialog key={editing?.id ?? `new-${presetParent ?? "root"}`} open={open} onOpenChange={setOpen} editing={editing} presetParent={presetParent} all={warehouses} />
    </Card>
  );
}
