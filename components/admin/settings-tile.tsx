"use client";

import { useState, type ReactNode } from "react";
import { Icon } from "@/components/icon";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

/**
 * Generic integration tile → opens a dialog with its settings form. Used by EVERY
 * integration (sales platforms, payment gateway, email) so they all look and behave the
 * same, and a new integration is just another tile.
 */
export function SettingsTile({ label, icon, brandCls, configured, enabled, dialogTitle, dialogDescription, children }: {
  label: string; icon: string; brandCls: string; configured: boolean; enabled?: boolean;
  dialogTitle: string; dialogDescription?: string; children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const dotOn = enabled === undefined ? configured : enabled;
  const statusText = `${configured ? "مُعدّة" : "غير مُعدّة"}${enabled === undefined ? "" : enabled ? " · مُفعّلة" : " · موقوفة"}`;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group flex items-center gap-3 rounded-xl border bg-card p-4 text-start transition hover:border-primary/40 hover:shadow-sm"
      >
        <div className={`flex size-11 shrink-0 items-center justify-center rounded-xl ${brandCls}`}>
          <Icon name={icon} className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{label}</div>
          <div className="mt-0.5 flex items-center gap-1.5 text-xs">
            <span className={`inline-block size-1.5 rounded-full ${dotOn ? "bg-emerald-500" : "bg-muted-foreground/40"}`} />
            <span className="text-muted-foreground">{statusText}</span>
          </div>
        </div>
        <Icon name="ChevronLeft" className="size-4 shrink-0 text-muted-foreground transition group-hover:text-primary" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className={`flex size-8 items-center justify-center rounded-lg ${brandCls}`}><Icon name={icon} className="size-4" /></span>
              {dialogTitle}
            </DialogTitle>
            {dialogDescription && <DialogDescription>{dialogDescription}</DialogDescription>}
          </DialogHeader>
          {children}
        </DialogContent>
      </Dialog>
    </>
  );
}
