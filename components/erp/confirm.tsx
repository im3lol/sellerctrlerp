"use client";

import { useSyncExternalStore } from "react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export type ConfirmOpts = { title?: string; description?: string; confirmText?: string; cancelText?: string; danger?: boolean };
type State = { open: boolean; opts: ConfirmOpts };

let state: State = { open: false, opts: {} };
let resolver: ((v: boolean) => void) | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const getSnapshot = () => state;

/** Promise-based confirmation backed by a single mounted <ConfirmHost/>. */
export function confirm(opts: ConfirmOpts = {}): Promise<boolean> {
  return new Promise((resolve) => {
    resolver = resolve;
    state = { open: true, opts };
    emit();
  });
}

function settle(v: boolean) {
  if (!state.open) return;
  state = { open: false, opts: state.opts };
  emit();
  const r = resolver;
  resolver = null;
  r?.(v);
}

export function ConfirmHost() {
  const s = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const o = s.opts;
  return (
    <AlertDialog open={s.open} onOpenChange={(open) => { if (!open) settle(false); }}>
      <AlertDialogContent size="sm" dir="rtl">
        <AlertDialogHeader>
          <AlertDialogTitle>{o.title ?? "تأكيد الإجراء"}</AlertDialogTitle>
          <AlertDialogDescription>{o.description ?? "هل تريد تنفيذ هذا الأمر؟"}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => settle(false)}>{o.cancelText ?? "إلغاء"}</AlertDialogCancel>
          <AlertDialogAction variant={o.danger ? "destructive" : "default"} onClick={() => settle(true)}>{o.confirmText ?? "تأكيد"}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
