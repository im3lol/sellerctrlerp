"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { BulkResult } from "@/lib/erp/bulk-delete";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

const int = (n: number) => Number(n).toLocaleString("ar-EG-u-nu-latn");

/** Row-selection state for a table (works for a single client-rendered set or a page). */
export function useSelection() {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const ids = useMemo(() => [...sel], [sel]);
  return {
    ids,
    size: sel.size,
    has: (id: string) => sel.has(id),
    toggle: (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; }),
    /** Toggle a set of ids (e.g. the whole page) on/off. */
    togglePage: (pageIds: string[]) => setSel((s) => (pageIds.length > 0 && pageIds.every((id) => s.has(id)) ? new Set() : new Set(pageIds))),
    allOf: (pageIds: string[]) => pageIds.length > 0 && pageIds.every((id) => sel.has(id)),
    someOf: (pageIds: string[]) => pageIds.some((id) => sel.has(id)),
    clear: () => setSel(new Set()),
  };
}

/** Toolbar shown when rows are selected: confirms + runs a bulk-delete action. */
export function BulkDeleteBar({ ids, action, onDone, entity = "عنصر" }: {
  ids: string[];
  action: (ids: string[]) => Promise<BulkResult>;
  onDone: () => void;
  entity?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  if (ids.length === 0) return null;

  const run = () => start(async () => {
    const r = await action(ids);
    if (!r.ok) { toast.error(r.error); return; }
    toast.success(`تم حذف ${int(r.deleted)} ${entity}${r.blocked ? ` · ${int(r.blocked)} لم يُحذف (مرتبط/مُرحّل)` : ""}`);
    onDone();
    router.refresh();
  });

  return (
    <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 px-3 py-2 text-sm">
      <span className="font-medium">{int(ids.length)} محدّد</span>
      <button type="button" className="text-muted-foreground hover:text-foreground" onClick={onDone}>إلغاء التحديد</button>
      <div className="ms-auto">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" size="sm" disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}حذف ({int(ids.length)})
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>حذف {int(ids.length)} {entity}؟</AlertDialogTitle>
              <AlertDialogDescription>لا يمكن التراجع. أي عنصر مرتبط بحركات أو مُرحّل لن يُحذف وسيتم تجاهله.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>إلغاء</AlertDialogCancel>
              <AlertDialogAction onClick={run} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">حذف</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}

/** A header/row checkbox styled consistently. */
export function SelectBox({ checked, indeterminate, onChange, label }: { checked: boolean; indeterminate?: boolean; onChange: () => void; label: string }) {
  return (
    <input
      type="checkbox"
      aria-label={label}
      className="size-4 rounded border-input align-middle"
      checked={checked}
      ref={(el) => { if (el) el.indeterminate = !!indeterminate && !checked; }}
      onChange={onChange}
    />
  );
}
