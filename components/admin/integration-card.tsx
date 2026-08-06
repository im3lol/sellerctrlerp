"use client";

import { useState } from "react";
import { Icon } from "@/components/icon";
import { IntegrationSettingsForm, type IntegrationInitial } from "./integration-settings-form";
import type { IntegrationField } from "@/lib/erp/marketplace/connector";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

// Per-connector brand accent + icon (no brand SVGs available — a coloured badge + a
// commerce glyph reads clearly). Unknown connectors fall back to a neutral store tile.
const BRAND: Record<string, { cls: string; icon: string }> = {
  AMAZON: { cls: "bg-amber-500/15 text-amber-600", icon: "Store" },
  NOON: { cls: "bg-yellow-400/20 text-yellow-600", icon: "ShoppingBag" },
  SHOPIFY: { cls: "bg-emerald-500/15 text-emerald-600", icon: "ShoppingCart" },
};

/** A clickable platform tile that opens a dialog with the connector's config form. */
export function IntegrationCard({ code, label, fields, hasOAuth, appUrl, initial }: {
  code: string; label: string; fields: IntegrationField[]; hasOAuth: boolean; appUrl: string; initial: IntegrationInitial;
}) {
  const [open, setOpen] = useState(false);
  const brand = BRAND[code] ?? { cls: "bg-muted text-muted-foreground", icon: "Store" };
  const configured = initial.has.clientSecret || !!initial.text.clientId;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group flex items-center gap-3 rounded-xl border bg-card p-4 text-start transition hover:border-primary/40 hover:shadow-sm"
      >
        <div className={`flex size-11 shrink-0 items-center justify-center rounded-xl ${brand.cls}`}>
          <Icon name={brand.icon} className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{label}</div>
          <div className="mt-0.5 flex items-center gap-1.5 text-xs">
            <span className={`inline-block size-1.5 rounded-full ${initial.enabled ? "bg-emerald-500" : "bg-muted-foreground/40"}`} />
            <span className="text-muted-foreground">{configured ? "مُعدّة" : "غير مُعدّة"}{initial.enabled ? " · مُفعّلة" : " · موقوفة"}</span>
          </div>
        </div>
        <Icon name="ChevronLeft" className="size-4 shrink-0 text-muted-foreground transition group-hover:text-primary" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className={`flex size-8 items-center justify-center rounded-lg ${brand.cls}`}><Icon name={brand.icon} className="size-4" /></span>
              ربط {label}
            </DialogTitle>
            <DialogDescription>أدخل مفاتيح التطبيق لتفعيل الربط. تُخزَّن الأسرار مشفّرة.</DialogDescription>
          </DialogHeader>
          <IntegrationSettingsForm code={code} label={label} fields={fields} hasOAuth={hasOAuth} appUrl={appUrl} initial={initial} />
        </DialogContent>
      </Dialog>
    </>
  );
}
