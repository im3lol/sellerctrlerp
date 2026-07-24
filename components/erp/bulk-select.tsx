"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";
import type { BulkResult } from "@/lib/erp/bulk-delete";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

const int = (n: number) => Number(n).toLocaleString("ar-EG-u-nu-latn");

/**
 * Row-selection state for a table (works for a single client-rendered set or a page).
 * Pass `total` (the filtered count across ALL pages) to enable "select all pages":
 * `selectAllPages()` marks the WHOLE filtered set; any manual toggle exits that mode.
 * The server re-derives the ids from the filter, so the client never ships them.
 */
export function useSelection(total?: number) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [allPages, setAllPages] = useState(false);
  const ids = useMemo(() => [...sel], [sel]);
  return {
    ids,
    size: sel.size,
    /** True selection size: the filtered total when "all pages" is active. */
    count: allPages ? (total ?? sel.size) : sel.size,
    allPages,
    selectAllPages: () => setAllPages(true),
    has: (id: string) => allPages || sel.has(id),
    toggle: (id: string) => { setAllPages(false); setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; }); },
    /** Toggle a set of ids (e.g. the whole page) on/off. */
    togglePage: (pageIds: string[]) => { setAllPages(false); setSel((s) => (pageIds.length > 0 && pageIds.every((id) => s.has(id)) ? new Set() : new Set(pageIds))); },
    allOf: (pageIds: string[]) => allPages || (pageIds.length > 0 && pageIds.every((id) => sel.has(id))),
    someOf: (pageIds: string[]) => allPages || pageIds.some((id) => sel.has(id)),
    clear: () => { setSel(new Set()); setAllPages(false); },
  };
}

/** "Select all N across pages" affordance config for the bulk bars. */
export type AllPagesState = {
  total: number;      // filtered count across all pages
  active: boolean;    // allPages mode on
  canOffer: boolean;  // whole visible page selected AND more pages exist
  onSelectAll: () => void;
};

/** Toolbar shown when rows are selected: confirms + runs a bulk-delete action.
 *  `all` (optional) enables the "select all N across pages" link; when active the
 *  action receives allPages=true and must re-derive ids from the filter server-side. */
export function BulkDeleteBar({ ids, action, onDone, entity = "عنصر", all }: {
  ids: string[];
  action: (ids: string[], allPages?: boolean) => Promise<BulkResult>;
  onDone: () => void;
  entity?: string;
  all?: AllPagesState;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const active = !!all?.active;
  const count = active ? all!.total : ids.length;
  if (count === 0) return null;

  const run = () => start(async () => {
    const r = await action(ids, active);
    if (!r.ok) { toast.error(r.error); return; }
    toast.success(`تم حذف ${int(r.deleted)} ${entity}${r.blocked ? ` · ${int(r.blocked)} لم يُحذف (مرتبط/مُرحّل)` : ""}`);
    onDone();
    router.refresh();
  });

  return (
    <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 px-3 py-2 text-sm">
      <span className="font-medium">{active ? `كل الـ${int(count)} محدّد` : `${int(count)} محدّد`}</span>
      {all && !active && all.canOffer && (
        <button type="button" className="text-primary underline" onClick={all.onSelectAll}>حدّد الكل ({int(all.total)}) في كل الصفحات</button>
      )}
      <button type="button" className="text-muted-foreground hover:text-foreground" onClick={onDone}>إلغاء التحديد</button>
      <div className="ms-auto">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" size="sm" disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}حذف ({int(count)})
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>حذف {int(count)} {entity}؟</AlertDialogTitle>
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

/** One bulk op button config. `danger` styles the confirm dialog + button. */
export type BulkOp<T extends string = string> = { op: T; label: string; icon?: string; danger?: boolean };

/**
 * Multi-op bulk toolbar for documents (confirm/post/cancel/delete…). Each op
 * runs the entity's `action(op, ids)` — which reuses the guarded single-item
 * action per row, so ineligible rows are skipped and reported via `count`.
 * Generic over the op union so a narrowly-typed `action` (e.g. "confirm"|"delete")
 * stays assignable.
 */
export function BulkBar<T extends string>({ ids, ops, action, onDone, entity = "عنصر", all }: {
  ids: string[];
  ops: BulkOp<T>[];
  action: (op: T, ids: string[], allPages?: boolean) => Promise<{ ok?: boolean; count?: number; error?: string }>;
  onDone: () => void;
  entity?: string;
  all?: AllPagesState;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [ask, setAsk] = useState<BulkOp<T> | null>(null);
  const active = !!all?.active;
  const count = active ? all!.total : ids.length;
  if (count === 0) return null;

  const run = (o: BulkOp<T>) => start(async () => {
    setAsk(null);
    const r = await action(o.op, ids, active);
    if (!r.ok) { toast.error(r.error ?? "تعذّر التنفيذ"); return; }
    toast.success(`تم ${o.label}: ${int(r.count ?? 0)} ${entity}`);
    onDone();
    router.refresh();
  });

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
      <span className="font-medium">{active ? `كل الـ${int(count)} محدّد` : `${int(count)} محدّد`}</span>
      {all && !active && all.canOffer && (
        <button type="button" className="text-primary underline" onClick={all.onSelectAll}>حدّد الكل ({int(all.total)}) في كل الصفحات</button>
      )}
      <button type="button" className="text-muted-foreground hover:text-foreground" onClick={onDone}>إلغاء التحديد</button>
      <div className="ms-auto flex flex-wrap gap-2">
        {ops.map((o) => (
          <Button key={o.op} size="sm" variant={o.danger ? "ghost" : "outline"} disabled={pending} onClick={() => setAsk(o)}>
            {o.icon && <Icon name={o.icon} className={`size-4 ${o.danger ? "text-destructive" : ""}`} />}{o.label}
          </Button>
        ))}
      </div>
      <AlertDialog open={!!ask} onOpenChange={(o) => !o && setAsk(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{ask?.label} {int(count)} {entity}؟</AlertDialogTitle>
            <AlertDialogDescription>الصفوف غير المؤهّلة لهذه العملية ستُتجاهَل تلقائياً.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>تراجع</AlertDialogCancel>
            <AlertDialogAction onClick={() => ask && run(ask)} className={ask?.danger ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : ""}>{ask?.label}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
