"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { BulkBarcodePrintButton, type BulkRow } from "@/components/erp/barcode-print";

export type DocAction = {
  label: string;
  /** A lucide name. `<Icon>` renders NOTHING for an unknown one, so check new names
   *  against the installed package rather than trusting the spelling. */
  icon: string;
  onSelect?: () => void;
  href?: string;
  newTab?: boolean;
  danger?: boolean;
  disabled?: boolean;
};

/**
 * The shared header action bar for a document: an optional primary button, then one
 * «إجراءات» menu holding everything else.
 *
 * Document headers had grown to four, five, six buttons — a title bar mostly spent on
 * things pressed rarely. One trigger holds them now, and every document gets the same
 * shape so the menu is always in the same place.
 *
 * The primary slot exists so the next step in the workflow (تأكيد, ترحيل…) stays a
 * visible button. Burying that behind a menu is the one thing this pattern should not do.
 *
 * Barcode printing is passed as data rather than as a button, because its dialog cannot
 * live inside a menu item: selecting the item closes the menu and would unmount the
 * dialog with it. It is rendered here as a sibling, in controlled mode.
 */
export function DocumentActions({
  primary,
  items = [],
  barcode,
  extra,
}: {
  primary?: ReactNode;
  items?: DocAction[];
  barcode?: { docTitle: string; rows: BulkRow[] };
  /** Anything that must stay outside the menu (a second dialog-owning component). */
  extra?: ReactNode;
}) {
  const [barcodeOpen, setBarcodeOpen] = useState(false);
  const visible = items.filter(Boolean);
  const hasBarcode = !!barcode?.rows.length;
  if (!visible.length && !hasBarcode && !primary && !extra) return null;

  // Printing needs no write permission — a viewer may still take a document to paper —
  // so print/barcode sit above the separator and the mutating actions below it.
  const printish = visible.filter((a) => a.icon === "Printer");
  const rest = visible.filter((a) => a.icon !== "Printer");

  const item = (a: DocAction, i: number) =>
    a.href ? (
      <DropdownMenuItem key={`${a.label}-${i}`} asChild disabled={a.disabled}>
        <Link href={a.href} {...(a.newTab ? { target: "_blank", rel: "noopener" } : {})}>
          <Icon name={a.icon} className={`size-4${a.danger ? " text-destructive" : ""}`} />{a.label}
        </Link>
      </DropdownMenuItem>
    ) : (
      <DropdownMenuItem key={`${a.label}-${i}`} disabled={a.disabled} onSelect={a.onSelect}>
        <Icon name={a.icon} className={`size-4${a.danger ? " text-destructive" : ""}`} />{a.label}
      </DropdownMenuItem>
    );

  return (
    <div className="flex flex-wrap items-center gap-2">
      {primary}
      {(visible.length > 0 || hasBarcode) && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline">
              <Icon name="Ellipsis" className="size-4" />إجراءات
              <Icon name="ChevronDown" className="size-3.5 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {printish.map(item)}
            {hasBarcode && (
              <DropdownMenuItem onSelect={() => setBarcodeOpen(true)}>
                <Icon name="Barcode" className="size-4" />طباعة باركود
              </DropdownMenuItem>
            )}
            {(printish.length > 0 || hasBarcode) && rest.length > 0 && <DropdownMenuSeparator />}
            {rest.map(item)}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {barcode && <BulkBarcodePrintButton docTitle={barcode.docTitle} rows={barcode.rows} open={barcodeOpen} onOpenChange={setBarcodeOpen} hideTrigger />}
      {extra}
    </div>
  );
}
